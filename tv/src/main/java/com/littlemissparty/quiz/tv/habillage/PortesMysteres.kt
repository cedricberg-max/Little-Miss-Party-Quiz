package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
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
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.GenericShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sin

/*
 * Les Portes mystères : la manche du destin, à la fin de la fête. Chaque équipe choisit une porte en secret ;
 * derrière, un bonus ou un malus qui peut renverser le classement.
 *
 * Ces écrans ne font qu'animer ce que la partie leur donne : les phases (choix, porte suivante, classement) sont
 * avancées par la régie, jamais par une animation. Si l'animatrice va plus vite que l'animation, l'écran suivant
 * remplace simplement le précédent ; aucune touche n'est bloquée. Tout tient de 1 à 8 équipes.
 */

const val PORTE_JACKPOT = 300
const val PORTE_BONUS = 150
const val PORTE_PETIT_BONUS = 50
const val PORTE_TUILE = -150

/** Contenu des portes, avant mélange : 3 portes jusqu'à 3 équipes, 4 au-delà. */
fun valeursPortes(nbEquipes: Int): List<Int> =
    if (nbEquipes <= 3) listOf(PORTE_JACKPOT, PORTE_BONUS, PORTE_TUILE) else listOf(PORTE_JACKPOT, PORTE_BONUS, PORTE_PETIT_BONUS, PORTE_TUILE)

/** Un score ne descend jamais sous 0. */
fun scoreApresPorte(avant: Int, valeur: Int): Int = max(0, avant + valeur)

fun nomContenu(valeur: Int): String = when {
    valeur < 0 -> "La tuile"
    valeur >= PORTE_JACKPOT -> "Jackpot"
    valeur >= PORTE_BONUS -> "Bonus"
    else -> "Petit bonus"
}

fun iconeContenu(valeur: Int): String = when {
    valeur < 0 -> "🧱"
    valeur >= PORTE_JACKPOT -> "💰"
    valeur >= PORTE_BONUS -> "🎁"
    else -> "🍬"
}

/** 1 250 : les milliers séparés par une espace, quelle que soit la langue de la box. */
fun espaceMilliers(n: Int): String = (if (n < 0) "−" else "") + abs(n).toString().reversed().chunked(3).joinToString(" ").reversed()

/** « +300 », « −150 » (vrai signe moins). */
fun texteValeur(v: Int): String = (if (v < 0) "−" else "+") + abs(v)

/** Une équipe pendant le choix des portes : [aChoisi] passe à vrai dès qu'elle a choisi (sans dire quelle porte). */
data class EquipePorte(val nom: String, val couleur: Color, val aChoisi: Boolean = true)

/** Une porte et ce qu'elle cache : sa valeur et les équipes qui l'ont choisie (aucune, une ou plusieurs). */
data class PorteOuverte(val valeur: Int, val equipes: List<EquipePorte>)

/** Une ligne du classement final : scores avant et après les portes, rangs (1 = premier) calculés par la partie. */
data class LignePortes(val nom: String, val couleur: Color, val avant: Int, val apres: Int, val rangAvant: Int, val rangApres: Int)

/** Rang (0 = premier) de chaque équipe selon [scores] ; à égalité, [departage] (rang précédent) puis l'ordre des équipes. */
fun rangs(scores: List<Int>, departage: List<Int>? = null): List<Int> {
    val ordre = scores.indices.sortedWith(compareByDescending<Int> { scores[it] }.thenBy { departage?.get(it) ?: 0 }.thenBy { it })
    val r = IntArray(scores.size)
    ordre.forEachIndexed { place, i -> r[i] = place }
    return r.toList()
}

enum class Recit { TOUJOURS_EN_TETE, NOUVEAU_PREMIER, TUILE_DU_PREMIER, MONTE, DESCEND, TIENT, AUCUN }

/** Ce qui arrive à une équipe ; rangs à partir de 0. */
data class Evolution(val rangAvant: Int, val rangApres: Int, val recit: Recit) {
    val places get() = rangAvant - rangApres
}

/** Ce qui arrive à chaque équipe entre le classement d'avant et celui d'après les portes. */
fun evolutions(lignes: List<LignePortes>): List<Evolution> = lignes.map { l ->
    val a = l.rangAvant - 1
    val p = l.rangApres - 1
    val recit = when {
        lignes.size == 1 -> Recit.TOUJOURS_EN_TETE
        a == 0 && p == 0 -> Recit.TOUJOURS_EN_TETE
        p == 0 -> Recit.NOUVEAU_PREMIER
        a == 0 -> Recit.TUILE_DU_PREMIER
        p < a -> Recit.MONTE
        p > a -> Recit.DESCEND
        l.apres > l.avant -> Recit.TIENT
        else -> Recit.AUCUN
    }
    Evolution(a, p, recit)
}

/** Le premier a changé : « RENVERSEMENT ! ». */
fun renversement(lignes: List<LignePortes>): Boolean = evolutions(lignes).any { it.recit == Recit.NOUVEAU_PREMIER }

fun texteRecit(e: Evolution): String? = when (e.recit) {
    Recit.TOUJOURS_EN_TETE -> "Toujours en tête !"
    Recit.NOUVEAU_PREMIER -> "Nouveau n°1 !"
    Recit.TUILE_DU_PREMIER -> "Aïe, la tuile !"
    Recit.MONTE -> "+${e.places} place${if (e.places > 1) "s" else ""} !"
    Recit.DESCEND -> "−${-e.places} place${if (e.places < -1) "s" else ""}"
    Recit.TIENT -> "Ça tient !"
    Recit.AUCUN -> null
}

private val jouerSon: (Son) -> Unit = { Sons.executer(listOf(Ordre.Jouer(it))) }

/* ------------------------------------------------------------------ Annonce */

/** « LA MANCHE DU DESTIN · Tout peut basculer ! » et ce qui se cache derrière les portes. */
@Composable
fun IntroPortes(valeurs: List<Int>, modifier: Modifier = Modifier, jouer: (Son) -> Unit = jouerSon) {
    val t = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        jouer(Son.MANCHE)
        t.animateTo(3_000f, tween(3_000, easing = LinearEasing))
    }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(1_400)
        jouer(Son.IMPACT)
    }
    Echelle(960.dp, 540.dp, modifier) {
        Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
            LogoLmp(54.dp)
            Spacer(Modifier.height(8.dp))
            Text("DERNIÈRE MANCHE", style = TextStyle(fontFamily = PoliceLmp, color = Neon.Or, fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = 8.sp))
            Spacer(Modifier.height(6.dp))
            Text(
                "LA MANCHE DU DESTIN",
                maxLines = 1, softWrap = false,
                style = TextStyle(fontFamily = PoliceLmp,
                    brush = Brush.verticalGradient(listOf(Color(0xFFFFF6DC), Neon.OrClair, Color(0xFFC9974F), Neon.Or)),
                    fontSize = 64.sp, lineHeight = 70.sp, fontWeight = FontWeight.Black,
                    shadow = Shadow(Color(0xFFFF2D8A).copy(alpha = 0.7f), Offset.Zero, 30f),
                ),
                modifier = Modifier.graphicsLayer {
                    val p = ((t.value - 150f) / 700f).coerceIn(0f, 1f)
                    val s = 0.6f + 0.4f * p + 0.08f * sin(p * PI.toFloat())
                    scaleX = s
                    scaleY = s
                    alpha = p
                },
            )
            Text(
                "Tout peut basculer !",
                style = TextStyle(fontFamily = PoliceLmp, color = Neon.Blanc, fontSize = 34.sp, fontWeight = FontWeight.Black),
                modifier = Modifier.graphicsLayer {
                    val p = ((t.value - 1_400f) / 260f).coerceIn(0f, 1f)
                    val s = 2.2f - 1.2f * p
                    scaleX = s
                    scaleY = s
                    alpha = p
                },
            )
            Spacer(Modifier.height(16.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.graphicsLayer { alpha = ((t.value - 2_000f) / 400f).coerceIn(0f, 1f) },
            ) {
                valeurs.sortedDescending().forEach { v ->
                    Row(
                        Modifier
                            .background(Color.White.copy(alpha = 0.1f), RoundedCornerShape(50))
                            .border(1.5.dp, Color.White.copy(alpha = 0.2f), RoundedCornerShape(50))
                            .padding(horizontal = 14.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("${nomContenu(v)} ", style = TextStyle(fontFamily = PoliceLmp, color = Neon.Blanc, fontSize = 18.sp, fontWeight = FontWeight.Bold))
                        Text(texteValeur(v), style = TextStyle(fontFamily = PoliceLmp, color = if (v < 0) Neon.Faux else Neon.JusteClair, fontSize = 18.sp, fontWeight = FontWeight.Black))
                    }
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ Choix */

/**
 * Les portes fermées pendant que toutes les équipes choisissent en même temps, en secret, sur leur tablette.
 * En bas, chaque équipe passe à « ✓ » dès qu'elle a choisi, sans jamais montrer quelle porte. [secondes] et
 * [fraction] : chrono facultatif.
 */
@Composable
fun ChoixPortes(
    nombre: Int,
    equipes: List<EquipePorte>,
    secondes: Int?,
    fraction: Float?,
    modifier: Modifier = Modifier,
    jouer: (Son) -> Unit = jouerSon,
) {
    val choisies = equipes.count { it.aChoisi }
    val depart = remember { choisies }
    LaunchedEffect(choisies) { if (choisies > depart) jouer(Son.pop(choisies - 1)) }
    val tous = equipes.isNotEmpty() && choisies == equipes.size
    Echelle(960.dp, 540.dp, modifier) {
        Bandeau(if (tous) "Les jeux sont faits !" else "Choisissez votre porte ", if (tous) null else "sur la tablette !", Modifier.align(Alignment.TopCenter).padding(top = 16.dp))
        if (secondes != null) ChronoPictionary(secondes, fraction ?: 0f, Modifier.align(Alignment.TopEnd).padding(top = 8.dp, end = 16.dp))
        RangeePortes(
            valeurs = List(nombre.coerceIn(1, 4)) { 0 },
            equipes = { emptyList() },
            ouvertes = emptySet(),
            enCours = null,
            ms = { 0f },
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 40.dp),
        )
        EquipesQuiChoisissent(equipes, Modifier.align(Alignment.BottomCenter).padding(bottom = 18.dp))
    }
}

/** Les équipes, en bas de l'écran : ✓ quand elle a choisi, petits points qui attendent sinon. Jusqu'à 8, sur deux lignes. */
@Composable
private fun EquipesQuiChoisissent(equipes: List<EquipePorte>, modifier: Modifier = Modifier) {
    val boucle = rememberInfiniteTransition(label = "attente")
    val attente by boucle.animateFloat(0.35f, 1f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "attente")
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        equipes.chunked(4).forEach { ligne ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ligne.forEach { e ->
                    Row(
                        Modifier
                            .widthIn(max = 220.dp)
                            .background(if (e.aChoisi) e.couleur.copy(alpha = 0.28f) else Neon.Nuit2.copy(alpha = 0.7f), RoundedCornerShape(50))
                            .border(2.dp, e.couleur.copy(alpha = if (e.aChoisi) 1f else 0.5f), RoundedCornerShape(50))
                            .rebond(e.aChoisi, 0.15f)
                            .padding(start = 6.dp, end = 12.dp, top = 3.dp, bottom = 3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(22.dp).background(if (e.aChoisi) Neon.JusteClair else Color.White.copy(alpha = 0.15f), CircleShape), contentAlignment = Alignment.Center) {
                            if (e.aChoisi) {
                                Text("✓", style = TextStyle(fontFamily = PoliceLmp, color = Neon.JusteTexte, fontSize = 15.sp, fontWeight = FontWeight.Black))
                            } else {
                                Text("…", style = TextStyle(fontFamily = PoliceLmp, color = Neon.Blanc, fontSize = 13.sp, fontWeight = FontWeight.Black), modifier = Modifier.graphicsLayer { alpha = attente })
                            }
                        }
                        Spacer(Modifier.width(7.dp))
                        Text(e.nom, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = PoliceLmp, color = Neon.Blanc, fontSize = 16.sp, fontWeight = FontWeight.Black))
                    }
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ Ouverture */

private const val ZOOM_MS = 700f
private const val TAMBOUR_MS = 2_000f
private const val OUVRE_MS = ZOOM_MS + TAMBOUR_MS
private const val CONTENU_MS = OUVRE_MS + 600f
private const val EQUIPES_MS = OUVRE_MS + 1_400f
private const val OUVERTURE_TOTAL_MS = EQUIPES_MS + 1_500f

/**
 * Ouverture des portes, une par une : les portes d'index < [ouvertes] sont ouvertes. Quand [ouvertes] augmente
 * pendant que l'écran est affiché, la nouvelle porte (index ouvertes − 1) s'anime : zoom, roulement de tambour,
 * ouverture, contenu, équipes qui l'ont choisie. Arrivé sur l'écran (TV relancée, reconnexion), tout est montré
 * fixe : aucune porte déjà ouverte n'est rejouée.
 */
@Composable
fun OuverturePortes(portes: List<PorteOuverte>, ouvertes: Int, modifier: Modifier = Modifier, jouer: (Son) -> Unit = jouerSon) {
    val depart = remember { ouvertes }
    val enCours = if (ouvertes > depart && ouvertes in 1..portes.size) ouvertes - 1 else null
    val t = remember(enCours) { Animatable(0f) }
    val joue by rememberUpdatedState(jouer)
    val valeurs = portes.map { it.valeur }
    LaunchedEffect(enCours) {
        val k = enCours ?: return@LaunchedEffect
        val v = valeurs.getOrNull(k) ?: return@LaunchedEffect
        t.animateTo(ZOOM_MS, tween(ZOOM_MS.toInt(), easing = LinearEasing))
        joue(Son.ROULEMENT_LONG)
        t.animateTo(OUVRE_MS, tween(TAMBOUR_MS.toInt(), easing = LinearEasing))
        joue(Son.PORTES_OUVRE)
        t.animateTo(CONTENU_MS, tween((CONTENU_MS - OUVRE_MS).toInt(), easing = LinearEasing))
        joue(
            when {
                v < 0 -> Son.PORTES_TUILE
                v >= PORTE_JACKPOT -> Son.PORTES_JACKPOT
                v >= PORTE_BONUS -> Son.BONUS
                else -> Son.POINTS
            },
        )
        t.animateTo(OUVERTURE_TOTAL_MS, tween((OUVERTURE_TOTAL_MS - CONTENU_MS).toInt(), easing = LinearEasing))
    }
    val bandeau = when {
        enCours != null -> "Porte " to "${enCours + 1}…"
        ouvertes >= portes.size -> "Toutes les portes sont ouvertes !" to null
        else -> "Les portes mystères" to null
    }
    val ouvertesSet = (0 until ouvertes.coerceIn(0, portes.size)).toSet() - setOfNotNull(enCours)
    Echelle(960.dp, 540.dp, modifier) {
        Bandeau(bandeau.first, bandeau.second, Modifier.align(Alignment.TopCenter).padding(top = 16.dp))
        RangeePortes(
            valeurs = valeurs,
            // Les équipes d'une porte ne sont montrées qu'une fois la porte ouverte (sous la porte qu'on ouvre, puis au-dessus).
            equipes = { k -> if (k in ouvertesSet) portes[k].equipes else emptyList() },
            ouvertes = ouvertesSet,
            enCours = enCours,
            ms = { t.value },
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 40.dp),
        )
        if (enCours != null) {
            GainsPorte(portes[enCours], ms = { t.value }, Modifier.align(Alignment.BottomCenter).padding(bottom = 10.dp))
        }
        // Éclair de lumière quand la porte s'ouvre.
        Box(
            Modifier
                .fillMaxSize()
                .clearAndSetSemantics {}
                .graphicsLayer {
                    val u = ((t.value - OUVRE_MS) / 700f).coerceIn(0f, 1f)
                    alpha = if (enCours == null || u <= 0f || u >= 1f) 0f else (if (u < 0.15f) u / 0.15f else 1f - (u - 0.15f) / 0.85f)
                }
                .background(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.95f), Color(0x66FFE696), Color.Transparent))),
        )
    }
}

/** Les portes alignées, avec les équipes au-dessus ; zoom sur la porte [enCours]. */
@Composable
private fun RangeePortes(
    valeurs: List<Int>,
    equipes: (Int) -> List<EquipePorte>,
    ouvertes: Set<Int>,
    enCours: Int?,
    ms: () -> Float,
    modifier: Modifier = Modifier,
) {
    val n = valeurs.size.coerceAtLeast(1)
    Row(
        modifier
            .fillMaxWidth()
            .height(480.dp)
            .padding(horizontal = 30.dp)
            .graphicsLayer {
                val k = enCours ?: return@graphicsLayer
                val z = (ms() / ZOOM_MS).coerceIn(0f, 1f).let { 1f - (1f - it) * (1f - it) }
                val cx = (k + 0.5f) / n
                transformOrigin = TransformOrigin(cx, 0.62f)
                val s = 1f + 0.22f * z
                scaleX = s
                scaleY = s
                translationX = (0.5f - cx) * size.width * z
            },
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.Bottom,
    ) {
        valeurs.forEachIndexed { k, v ->
            val cible = enCours == k
            val estOuverte = k in ouvertes || cible
            Column(
                Modifier
                    .width(200.dp)
                    .graphicsLayer {
                        val z = (ms() / ZOOM_MS).coerceIn(0f, 1f)
                        alpha = if (enCours != null && !cible) 1f - 0.72f * z else 1f
                    },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                PucesPorte(equipes(k), Modifier.height(100.dp))
                Spacer(Modifier.height(8.dp))
                PorteMystere(
                    index = k,
                    valeur = v,
                    ouverture = {
                        when {
                            cible -> ((ms() - OUVRE_MS) / 900f).coerceIn(0f, 1f)
                            estOuverte -> 1f
                            else -> 0f
                        }
                    },
                    tremble = { cible && ms() in ZOOM_MS..OUVRE_MS },
                    contenu = {
                        when {
                            cible -> ((ms() - CONTENU_MS + 200f) / 420f).coerceIn(0f, 1f)
                            estOuverte -> 1f
                            else -> 0f
                        }
                    },
                )
                Spacer(Modifier.height(110.dp))
            }
        }
    }
}

/** Pastilles des équipes qui ont choisi cette porte, de bas en haut : une par ligne jusqu'à 4, deux au-delà (jusqu'à 8). */
@Composable
private fun PucesPorte(qui: List<EquipePorte>, modifier: Modifier = Modifier) {
    val parLigne = if (qui.size > 4) 2 else 1
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.Bottom), horizontalAlignment = Alignment.CenterHorizontally) {
        qui.chunked(parLigne).reversed().forEach { ligne ->
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                ligne.forEach { e ->
                    PuceEquipe(e.nom, e.couleur, if (parLigne == 2) 108.dp else 196.dp, Modifier.apparition(0, e.nom), taille = if (parLigne == 2) 11.sp else 13.sp)
                }
            }
        }
    }
}

@Composable
private fun PuceEquipe(nom: String, couleur: Color, largeurMax: Dp, modifier: Modifier = Modifier, taille: TextUnit = 13.sp) {
    Row(
        modifier
            .widthIn(max = largeurMax)
            .background(Neon.Nuit2.copy(alpha = 0.88f), RoundedCornerShape(50))
            .border(2.dp, couleur, RoundedCornerShape(50))
            .padding(start = 5.dp, end = 9.dp, top = 2.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(11.dp).background(couleur, CircleShape))
        Spacer(Modifier.width(5.dp))
        Text(nom, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = PoliceLmp, color = Neon.Blanc, fontSize = taille, fontWeight = FontWeight.Black))
    }
}

/** Sous la porte qu'on vient d'ouvrir : les points exacts et les équipes qui l'ont choisie. */
@Composable
private fun GainsPorte(porte: PorteOuverte, ms: () -> Float, modifier: Modifier = Modifier) {
    val visible by remember { derivedStateOf { ms() >= EQUIPES_MS } }
    if (!visible) return
    val qui = porte.equipes
    Column(
        modifier
            .apparition(0, porte)
            .background(Neon.Nuit2.copy(alpha = 0.88f), RoundedCornerShape(18.dp))
            .border(2.dp, Neon.Or.copy(alpha = 0.7f), RoundedCornerShape(18.dp))
            .padding(horizontal = 18.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            texteDelta(porte.valeur),
            style = TextStyle(fontFamily = PoliceLmp, color = if (porte.valeur < 0) Color.White else Neon.JusteTexte, fontSize = 22.sp, fontWeight = FontWeight.Black),
            modifier = Modifier
                .background(if (porte.valeur < 0) Neon.Faux else Neon.JusteClair, RoundedCornerShape(50))
                .padding(horizontal = 14.dp, vertical = 2.dp),
        )
        if (qui.isEmpty()) {
            Text("Personne n'a ouvert cette porte !", style = TextStyle(fontFamily = PoliceLmp, color = Neon.Blanc.copy(alpha = 0.8f), fontSize = 18.sp, fontWeight = FontWeight.Black))
        } else {
            // Jusqu'à 8 équipes derrière la même porte : 4 par ligne.
            qui.chunked(4).forEach { ligne ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ligne.forEach { e -> PuceEquipe(e.nom, e.couleur, 190.dp, taille = 15.sp) }
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ Une porte */

/** Laque d'une porte : haut et bas du dégradé. */
private class StylePorte(val haut: Color, val bas: Color)

/** Portes laquées façon art déco : bleu nuit, bordeaux, émeraude, prune. */
private val STYLES = listOf(
    StylePorte(Color(0xFF1D3A7A), Color(0xFF0A1638)),
    StylePorte(Color(0xFF7A1838), Color(0xFF34061A)),
    StylePorte(Color(0xFF0F5E4A), Color(0xFF052A22)),
    StylePorte(Color(0xFF3A2160), Color(0xFF140726)),
)

private val OR_CLAIR = Color(0xFFFFF3D1)
private val OR_MOYEN = Color(0xFFE9C27A)
private val OR_FONCE = Color(0xFFA8782F)
private val OR_CADRE = listOf(OR_FONCE, OR_CLAIR, OR_MOYEN, OR_FONCE, OR_CLAIR, OR_MOYEN)

/** Haut de la porte : couronne à gradins art déco (proportion de la hauteur occupée par les gradins). */
private const val COURONNE = 0.09f
private val Couronne = GenericShape { s, _ ->
    val w = s.width
    val h = s.height
    moveTo(0f, h * COURONNE)
    lineTo(w * 0.18f, h * COURONNE); lineTo(w * 0.18f, h * 0.04f)
    lineTo(w * 0.34f, h * 0.04f); lineTo(w * 0.34f, 0f)
    lineTo(w * 0.66f, 0f); lineTo(w * 0.66f, h * 0.04f)
    lineTo(w * 0.82f, h * 0.04f); lineTo(w * 0.82f, h * COURONNE)
    lineTo(w, h * COURONNE); lineTo(w, h); lineTo(0f, h)
    close()
}

/** Soleil art déco, panneau mouluré et poignée, dessinés en traits dorés sur la laque. */
private fun DrawScope.decorPorte() {
    val w = size.width
    val h = size.height
    // Reflet de la laque.
    drawRect(Brush.linearGradient(listOf(Color.White.copy(alpha = 0.08f), Color.Transparent, Color.Black.copy(alpha = 0.25f)), Offset.Zero, Offset(w, 0f)))
    // Soleil : demi-cercle doré et rayons.
    val r = w * 0.42f
    val centre = Offset(w / 2, h * 0.05f + r)
    val trait = 1.3.dp.toPx()
    drawArc(OR_MOYEN, 180f, 180f, false, Offset(centre.x - r, centre.y - r), Size(2 * r, 2 * r), style = Stroke(trait * 1.3f))
    var angle = 180.0 + 11.25
    while (angle < 360.0) {
        val a = Math.toRadians(angle)
        val c = kotlin.math.cos(a).toFloat()
        val sn = kotlin.math.sin(a).toFloat()
        drawLine(OR_MOYEN.copy(alpha = 0.6f), Offset(centre.x + c * r * 0.3f, centre.y + sn * r * 0.3f), Offset(centre.x + c * r, centre.y + sn * r), trait * 0.8f)
        angle += 11.25
    }
    // Panneau mouluré, double filet, losange au centre.
    val g = w * 0.12f
    val haut = h * 0.44f
    val bas = h * 0.93f
    drawRect(OR_MOYEN.copy(alpha = 0.7f), Offset(g, haut), Size(w - 2 * g, bas - haut), style = Stroke(trait))
    val i = (w - 2 * g) * 0.07f
    drawRect(OR_MOYEN.copy(alpha = 0.4f), Offset(g + i, haut + i), Size(w - 2 * g - 2 * i, bas - haut - 2 * i), style = Stroke(trait * 0.7f))
    val m = Offset(w / 2, (haut + bas) / 2)
    val d = w * 0.085f
    val losange = Path().apply { moveTo(m.x, m.y - d); lineTo(m.x + d, m.y); lineTo(m.x, m.y + d); lineTo(m.x - d, m.y); close() }
    drawPath(losange, OR_MOYEN.copy(alpha = 0.7f), style = Stroke(trait))
    // Poignée verticale en laiton.
    drawRoundRect(
        Brush.horizontalGradient(listOf(OR_FONCE, OR_CLAIR, OR_MOYEN), w * 0.89f, w * 0.93f),
        Offset(w * 0.89f, h * 0.52f), Size(w * 0.04f, h * 0.19f), CornerRadius(w * 0.02f),
    )
}

/**
 * Une porte mystère (150 × 260) façon art déco : cadre doré à gradins, battant laqué avec soleil et panneau
 * moulurés qui s'ouvre sur ses gonds ([ouverture] de 0 à 1), projecteur au-dessus et lumière au sol ; derrière,
 * le contenu ([contenu] de 0 à 1 pour son apparition).
 */
@Composable
private fun PorteMystere(index: Int, valeur: Int, ouverture: () -> Float, tremble: () -> Boolean, contenu: () -> Float) {
    val style = STYLES[Math.floorMod(index, STYLES.size)]
    val boucle = rememberInfiniteTransition(label = "porte")
    val respire by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(2_400 + index * 300), RepeatMode.Reverse), label = "respire")
    val vibre by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(90, easing = LinearEasing)), label = "vibre")
    Box(
        Modifier
            .width(150.dp)
            .aspectRatio(15f / 26f)
            .graphicsLayer {
                if (tremble()) {
                    translationX = 3f * sin(vibre * 2f * PI.toFloat())
                    rotationZ = 0.8f * sin(vibre * 4f * PI.toFloat())
                }
            }
            .drawBehind {
                // Projecteur qui tombe sur la porte, et la lumière au sol.
                val w = size.width
                val h = size.height
                val cone = Path().apply {
                    moveTo(w * 0.42f, -h * 0.5f); lineTo(w * 0.58f, -h * 0.5f)
                    lineTo(w * 1.3f, h); lineTo(-w * 0.3f, h); close()
                }
                drawPath(
                    cone,
                    Brush.verticalGradient(listOf(Color(0x40FFECBE), Color(0x10FFECBE)), -h * 0.5f, h),
                    alpha = 0.6f + 0.4f * respire,
                )
                drawOval(
                    Brush.radialGradient(listOf(Color(0x99FFDC96), Color.Transparent)),
                    Offset(-w * 0.1f, h - 10f), Size(w * 1.2f, 26f),
                )
            }
            .clip(Couronne)
            .background(Brush.linearGradient(OR_CADRE)),
    ) {
        val interieur = Modifier
            .fillMaxSize()
            .padding(start = 7.dp, end = 7.dp, top = (260 * COURONNE).dp + 7.dp)
        // Derrière la porte : la lumière et le contenu.
        Box(
            interieur.background(Brush.radialGradient(0f to Color(0xFFFFF6DC), 0.55f to Color(0xFFF1C46F), 1f to Color(0xFFC07F2E))),
            contentAlignment = Alignment.Center,
        ) {
            ContenuPorte(valeur, contenu)
        }
        // Le battant, qui pivote sur ses gonds (bord gauche).
        Box(
            interieur
                .graphicsLayer {
                    val o = ouverture()
                    val e = if (o <= 0f) 0f else 1f - (1f - o) * (1f - o) * (1f - o)
                    transformOrigin = TransformOrigin(0f, 0.5f)
                    cameraDistance = 9f * density
                    rotationY = -104f * e
                    alpha = if (e > 0.93f) 0f else 1f
                }
                .background(Brush.verticalGradient(listOf(style.haut, style.bas)))
                .drawBehind { decorPorte() },
        ) {
            // Numéro en médaille dorée, au cœur du soleil.
            Box(
                Modifier
                    .align(Alignment.TopCenter)
                    .offset(y = 20.dp)
                    .size(46.dp)
                    .background(OR_MOYEN, CircleShape)
                    .padding(2.dp)
                    .background(Color(0xFF24103D), CircleShape)
                    .padding(2.dp)
                    .background(Brush.radialGradient(listOf(OR_CLAIR, OR_MOYEN, OR_FONCE)), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text("${index + 1}", style = TextStyle(color = Color(0xFF24103D), fontSize = 26.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.ExtraBold))
            }
        }
    }
}

/** Ce qui apparaît derrière la porte : la valeur en grand, en lettres de gala, et son nom. */
@Composable
private fun ContenuPorte(valeur: Int, apparition: () -> Float) {
    Column(
        Modifier.graphicsLayer {
            val p = apparition()
            val s = if (p <= 0f) 0f else p + 0.2f * sin(p * PI.toFloat())
            scaleX = s
            scaleY = s
            alpha = if (p <= 0f) 0f else 1f
        },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val couleur = if (valeur < 0) Color(0xFF8E0F24) else Color(0xFF3A1C00)
        Text(
            texteValeur(valeur),
            style = TextStyle(
                color = couleur, fontSize = 38.sp, lineHeight = 40.sp, fontFamily = FontFamily.Serif,
                fontWeight = FontWeight.ExtraBold, shadow = Shadow(Color.White.copy(alpha = 0.6f), Offset(0f, 2f), 0f),
            ),
            modifier = Modifier.clearAndSetSemantics {},
        )
        Spacer(Modifier.height(4.dp))
        Text(
            nomContenu(valeur).uppercase(),
            textAlign = TextAlign.Center,
            style = TextStyle(fontFamily = PoliceLmp, color = couleur, fontSize = 12.sp, fontWeight = FontWeight.Black, letterSpacing = 2.sp),
        )
    }
}

/* ------------------------------------------------------------------ Classement final */

private const val DELTAS_MS = 900f
private const val BASCULE_MS = 2_400f
private const val RECITS_MS = 3_900f

/**
 * Le classement après les portes, raconté : les scores d'avant, les bonus et malus qui défilent, puis les équipes
 * qui changent de place, et ce qui arrive à chacune (« Toujours en tête ! », « Aïe, la tuile ! », « +2 places ! »).
 * Si le premier change, le bandeau « RENVERSEMENT ! » claque. Les scores montrés sont exactement ceux de la partie.
 */
@Composable
fun ClassementPortes(lignes: List<LignePortes>, modifier: Modifier = Modifier, jouer: (Son) -> Unit = jouerSon) {
    val equipes = lignes
    val evo = remember(lignes) { evolutions(lignes) }
    val renverse = evo.any { it.recit == Recit.NOUVEAU_PREMIER }
    val n = equipes.size.coerceAtLeast(1)
    val pasRecit = if (n > 5) 260f else 420f
    val finRecits = RECITS_MS + n * pasRecit
    val t = remember(equipes) { Animatable(0f) }
    LaunchedEffect(equipes) {
        jouer(Son.WHOOSH)
        t.animateTo(DELTAS_MS, tween(DELTAS_MS.toInt(), easing = LinearEasing))
        jouer(Son.COMPTEUR)
        t.animateTo(BASCULE_MS, tween((BASCULE_MS - DELTAS_MS).toInt(), easing = LinearEasing))
        jouer(Son.WHOOSH)
        t.animateTo(RECITS_MS, tween((RECITS_MS - BASCULE_MS).toInt(), easing = LinearEasing))
        // Une petite note par équipe, montante ou descendante, au rythme des étiquettes.
        evo.forEachIndexed { k, e ->
            t.animateTo(RECITS_MS + (k + 1) * pasRecit, tween(pasRecit.toInt(), easing = LinearEasing))
            if (e.recit == Recit.MONTE || e.recit == Recit.NOUVEAU_PREMIER || e.recit == Recit.TOUJOURS_EN_TETE) jouer(Son.pop(k)) else if (e.recit != Recit.AUCUN) jouer(Son.ETEINT)
        }
        t.animateTo(finRecits + 400f, tween(400, easing = LinearEasing))
        jouer(if (renverse) Son.PORTES_RENVERSEMENT else Son.COURONNE)
        t.animateTo(finRecits + 3_200f, tween(2_800, easing = LinearEasing))
    }
    val hauteur = minOf(54f, 400f / n)
    Echelle(960.dp, 540.dp, modifier) {
        Bandeau("Le classement ", "final !", Modifier.align(Alignment.TopCenter).padding(top = 16.dp))
        Box(
            Modifier
                .align(Alignment.TopCenter)
                .padding(top = 78.dp)
                // Décalé vers la gauche : les étiquettes du récit s'affichent à droite des lignes.
                .offset(x = (-85).dp)
                .width(600.dp)
                .height((hauteur * n).dp),
        ) {
            equipes.forEachIndexed { i, e -> LigneClassement(e, evo[i], i, hauteur, { t.value }, pasRecit) }
        }
        val couronne by remember { derivedStateOf { t.value >= BASCULE_MS + 900f } }
        if (couronne && n > 0) Confettis(0L, Modifier.fillMaxSize())
        if (renverse) BandeauRenversement({ t.value - finRecits - 400f }, Modifier.align(Alignment.Center))
    }
}

@Composable
private fun LigneClassement(e: LignePortes, evo: Evolution, i: Int, hauteur: Float, ms: () -> Float, pasRecit: Float) {
    val gain = e.apres - e.avant
    val texte = texteRecit(evo)
    val tete by remember(evo) { derivedStateOf { if (ms() < BASCULE_MS + 600f) evo.rangAvant == 0 else evo.rangApres == 0 } }
    val taille = (hauteur * 0.38f).sp
    Row(
        Modifier
            .fillMaxWidth()
            .height((hauteur - 6f).dp)
            .graphicsLayer {
                // Glissement de l'ancienne place à la nouvelle, avec un léger dépassement.
                val u = ((ms() - BASCULE_MS) / 1_300f).coerceIn(0f, 1f)
                val e2 = if (u >= 1f) 1f else 1f - (1f - u) * (1f - u) * (1f - u) * (1f - 2.2f * u)
                val rang = evo.rangAvant + (evo.rangApres - evo.rangAvant) * e2
                translationY = rang * hauteur * density
            }
            .background(
                if (tete) Brush.horizontalGradient(listOf(Color(0x59FFD166), Color(0x14FFD166))) else Brush.horizontalGradient(listOf(Color(0x21FFFFFF), Color(0x0DFFFFFF))),
                RoundedCornerShape(12.dp),
            )
            .border(if (tete) 2.dp else 0.dp, if (tete) Color(0xFFFFD166) else Color.Transparent, RoundedCornerShape(12.dp))
            .drawBehind { drawRect(e.couleur, size = Size(6.dp.toPx(), size.height)) }
            .padding(start = 16.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val rangMontre by remember(evo) { derivedStateOf { if (ms() < BASCULE_MS + 600f) evo.rangAvant else evo.rangApres } }
        Text("${rangMontre + 1}", style = TextStyle(fontFamily = PoliceLmp, color = Neon.Or, fontSize = taille, fontWeight = FontWeight.Black), modifier = Modifier.width((hauteur * 0.7f).dp))
        Text(e.nom, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = PoliceLmp, color = Neon.Blanc, fontSize = taille, fontWeight = FontWeight.Black), modifier = Modifier.weight(1f))
        Text(
            texteValeur(gain),
            style = TextStyle(fontFamily = PoliceLmp, color = if (gain < 0) Color.White else Neon.JusteTexte, fontSize = taille * 0.72f, fontWeight = FontWeight.Black),
            modifier = Modifier
                .graphicsLayer {
                    val p = ((ms() - DELTAS_MS) / 300f).coerceIn(0f, 1f)
                    alpha = p
                    scaleX = 0.5f + 0.5f * p
                    scaleY = 0.5f + 0.5f * p
                }
                .background(if (gain < 0) Neon.Faux else Neon.JusteClair, RoundedCornerShape(50))
                .padding(horizontal = 8.dp, vertical = 1.dp),
        )
        Spacer(Modifier.width(12.dp))
        val score by remember(e) { derivedStateOf { valeurCompteur(e.avant, e.apres, (ms() - DELTAS_MS) / 1_200f) } }
        Text(espaceMilliers(score), style = TextStyle(fontFamily = PoliceLmp, color = Neon.Blanc, fontSize = taille, fontWeight = FontWeight.Black), modifier = Modifier.widthIn(min = (hauteur * 1.6f).dp), textAlign = TextAlign.End)
    }
    if (texte != null) {
        // L'étiquette du récit, à droite de la ligne, une équipe après l'autre.
        val montre by remember(evo) { derivedStateOf { ms() >= RECITS_MS + i * pasRecit } }
        if (montre) {
            Box(
                Modifier
                    .offset(x = 608.dp)
                    .width(175.dp)
                    .height((hauteur - 6f).dp)
                    .graphicsLayer { translationY = evo.rangApres * hauteur * density },
            ) {
                val (fond, encre) = when (evo.recit) {
                    Recit.TOUJOURS_EN_TETE, Recit.NOUVEAU_PREMIER -> Color(0xFFFFD166) to Neon.Nuit2
                    Recit.TUILE_DU_PREMIER -> Neon.Faux to Color.White
                    Recit.MONTE -> Neon.JusteClair to Neon.JusteTexte
                    Recit.DESCEND -> Color(0xFFFFD0D1) to Color(0xFF8A0F1C)
                    else -> Color.White to Neon.Nuit2
                }
                Text(
                    texte,
                    maxLines = 1, softWrap = false,
                    style = TextStyle(fontFamily = PoliceLmp, color = encre, fontSize = taille * 0.7f, fontWeight = FontWeight.Black),
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .apparition(0, texte)
                        .background(fond, RoundedCornerShape(50))
                        .padding(horizontal = 10.dp, vertical = 2.dp),
                )
            }
        }
    }
}

/** « RENVERSEMENT ! » : bande rayée qui claque en travers de l'écran, tient, puis s'envole. */
@Composable
private fun BandeauRenversement(ms: () -> Float, modifier: Modifier = Modifier) {
    val visible by remember { derivedStateOf { ms() in 0f..2_600f } }
    if (!visible) return
    Box(
        modifier
            .fillMaxWidth()
            .graphicsLayer {
                val m = ms()
                val entree = (m / 360f).coerceIn(0f, 1f)
                val sortie = ((m - 2_100f) / 500f).coerceIn(0f, 1f)
                val s = 3f - 2f * entree + 0.04f * (m / 2_600f) - 0.4f * sortie
                scaleX = s
                scaleY = s
                rotationZ = -6f
                alpha = entree * (1f - sortie)
                translationY = -300f * sortie
            }
            .background(Neon.Nuit2)
            .padding(vertical = 5.dp)
            .background(Color.White)
            .padding(vertical = 4.dp)
            .drawBehind {
                drawRect(Color(0xFFFFD166))
                val pas = 40f
                var x = -size.height
                while (x < size.width) {
                    drawLine(Color(0xFFFFB000), Offset(x, size.height), Offset(x + size.height, 0f), pas / 2)
                    x += pas
                }
            }
            .padding(vertical = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text("RENVERSEMENT !", maxLines = 1, softWrap = false, style = TextStyle(fontFamily = PoliceLmp, color = Neon.Nuit2, fontSize = 62.sp, lineHeight = 66.sp, fontWeight = FontWeight.Black, letterSpacing = 2.sp))
    }
}

/* ------------------------------------------------------------------ Commun */

/** Bandeau doré du haut : « Au tour de » + nom de l'équipe en or. */
@Composable
private fun Bandeau(texte: String, accent: String?, modifier: Modifier = Modifier) {
    Row(
        modifier
            .widthIn(max = 880.dp)
            .background(Neon.Nuit2.copy(alpha = 0.78f), RoundedCornerShape(50))
            .border(2.dp, Neon.Or, RoundedCornerShape(50))
            .padding(horizontal = 26.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(texte, maxLines = 1, softWrap = false, style = TextStyle(fontFamily = PoliceLmp, color = Neon.Blanc, fontSize = 26.sp, fontWeight = FontWeight.Black))
        if (accent != null) {
            Text(accent, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(fontFamily = PoliceLmp, color = Color(0xFFFFD166), fontSize = 26.sp, fontWeight = FontWeight.Black))
        }
    }
}
