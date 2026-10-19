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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
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

/** Une équipe dans les Portes mystères. [porte] : index de la porte choisie, null tant qu'elle n'a pas choisi. */
data class EquipePortes(val nom: String, val couleur: Color, val avant: Int, val apres: Int, val porte: Int?)

/** Rang (0 = premier) de chaque équipe selon [scores] ; à égalité, [departage] (rang précédent) puis l'ordre des équipes. */
fun rangs(scores: List<Int>, departage: List<Int>? = null): List<Int> {
    val ordre = scores.indices.sortedWith(compareByDescending<Int> { scores[it] }.thenBy { departage?.get(it) ?: 0 }.thenBy { it })
    val r = IntArray(scores.size)
    ordre.forEachIndexed { place, i -> r[i] = place }
    return r.toList()
}

/** Le dernier choisit en premier, le premier en dernier. */
fun ordreChoix(equipes: List<EquipePortes>): List<Int> {
    val r = rangs(equipes.map { it.avant })
    return equipes.indices.sortedByDescending { r[it] }
}

/** Ordre d'ouverture conseillé : les portes vides d'abord, la porte de l'équipe en tête en dernier. */
fun ordreOuverture(equipes: List<EquipePortes>, nbPortes: Int): List<Int> {
    val r = rangs(equipes.map { it.avant })
    val meilleur = { k: Int -> equipes.indices.filter { equipes[it].porte == k }.minOfOrNull { r[it] } ?: Int.MAX_VALUE }
    return (0 until nbPortes).sortedWith(compareByDescending<Int> { meilleur(it) }.thenBy { it })
}

enum class Recit { TOUJOURS_EN_TETE, NOUVEAU_PREMIER, TUILE_DU_PREMIER, MONTE, DESCEND, TIENT, AUCUN }

data class Evolution(val rangAvant: Int, val rangApres: Int, val recit: Recit) {
    val places get() = rangAvant - rangApres
}

/** Ce qui arrive à chaque équipe entre le classement d'avant et celui d'après les portes. */
fun evolutions(equipes: List<EquipePortes>): List<Evolution> {
    val avant = rangs(equipes.map { it.avant })
    val apres = rangs(equipes.map { it.apres }, avant)
    return equipes.indices.map { i ->
        val a = avant[i]
        val p = apres[i]
        val recit = when {
            equipes.size == 1 -> Recit.TOUJOURS_EN_TETE
            a == 0 && p == 0 -> Recit.TOUJOURS_EN_TETE
            p == 0 -> Recit.NOUVEAU_PREMIER
            a == 0 -> Recit.TUILE_DU_PREMIER
            p < a -> Recit.MONTE
            p > a -> Recit.DESCEND
            equipes[i].apres > equipes[i].avant -> Recit.TIENT
            else -> Recit.AUCUN
        }
        Evolution(a, p, recit)
    }
}

/** Le premier a changé : « RENVERSEMENT ! ». */
fun renversement(equipes: List<EquipePortes>): Boolean = evolutions(equipes).any { it.recit == Recit.NOUVEAU_PREMIER }

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
            Text("DERNIÈRE MANCHE", style = TextStyle(color = Neon.Or, fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = 8.sp))
            Spacer(Modifier.height(6.dp))
            Text(
                "LA MANCHE DU DESTIN",
                maxLines = 1, softWrap = false,
                style = TextStyle(
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
                style = TextStyle(color = Neon.Blanc, fontSize = 34.sp, fontWeight = FontWeight.Black),
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
                        Text("${iconeContenu(v)} ${nomContenu(v)} ", style = TextStyle(color = Neon.Blanc, fontSize = 18.sp, fontWeight = FontWeight.Bold))
                        Text(texteValeur(v), style = TextStyle(color = if (v < 0) Neon.Faux else Neon.JusteClair, fontSize = 18.sp, fontWeight = FontWeight.Black))
                    }
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ Choix */

/**
 * Les portes fermées pendant que les équipes choisissent en secret sur leur tablette : la pastille de chaque
 * équipe qui a choisi se pose au-dessus de sa porte (le contenu, lui, reste caché). [auTour] : index de l'équipe
 * qui choisit maintenant, null quand tout le monde a choisi.
 */
@Composable
fun ChoixPortes(valeurs: List<Int>, equipes: List<EquipePortes>, auTour: Int?, modifier: Modifier = Modifier, jouer: (Son) -> Unit = jouerSon) {
    val choisies = equipes.count { it.porte != null }
    LaunchedEffect(choisies) { if (choisies > 0) jouer(Son.pop(choisies - 1)) }
    val bandeau = when {
        auTour != null && equipes.getOrNull(auTour) != null -> "Au tour de " to equipes[auTour].nom
        choisies == equipes.size && equipes.isNotEmpty() -> "Les jeux sont faits !" to null
        else -> "Le dernier choisit en premier !" to null
    }
    Echelle(960.dp, 540.dp, modifier) {
        Bandeau(bandeau.first, bandeau.second, Modifier.align(Alignment.TopCenter).padding(top = 16.dp))
        RangeePortes(valeurs, equipes, ouvertes = emptySet(), enCours = null, ms = { 0f }, Modifier.align(Alignment.BottomCenter))
    }
}

/* ------------------------------------------------------------------ Ouverture */

private const val ZOOM_MS = 700f
private const val TAMBOUR_MS = 2_000f
private const val OUVRE_MS = ZOOM_MS + TAMBOUR_MS
private const val CONTENU_MS = OUVRE_MS + 600f
private const val COMPTE_MS = OUVRE_MS + 1_500f
private const val OUVERTURE_TOTAL_MS = COMPTE_MS + 1_200f

/**
 * Ouverture des portes, une par une. [ouvertes] : portes déjà ouvertes (montrées ouvertes, sans animation) ;
 * [enCours] : la porte qu'on ouvre maintenant : zoom, roulement de tambour, la porte s'ouvre, son contenu jaillit
 * et les scores des équipes qui l'ont choisie défilent jusqu'à leur nouveau total ([EquipePortes.apres]).
 */
@Composable
fun OuverturePortes(
    valeurs: List<Int>,
    equipes: List<EquipePortes>,
    ouvertes: Set<Int>,
    enCours: Int?,
    modifier: Modifier = Modifier,
    jouer: (Son) -> Unit = jouerSon,
) {
    val t = remember(enCours) { Animatable(0f) }
    val joue by rememberUpdatedState(jouer)
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
        t.animateTo(COMPTE_MS, tween((COMPTE_MS - CONTENU_MS).toInt(), easing = LinearEasing))
        if (equipes.any { it.porte == k && it.apres != it.avant }) joue(Son.COMPTEUR)
        t.animateTo(OUVERTURE_TOTAL_MS, tween((OUVERTURE_TOTAL_MS - COMPTE_MS).toInt(), easing = LinearEasing))
    }
    val premier = rangs(equipes.map { it.avant }).indexOf(0)
    val bandeau = when {
        enCours != null && equipes.size > 1 && equipes.getOrNull(premier)?.porte == enCours -> "Et maintenant… la porte " to "du premier !"
        enCours != null -> "Porte " to "${enCours + 1}…"
        ouvertes.size >= valeurs.size -> "Toutes les portes sont ouvertes !" to null
        else -> "Les portes mystères" to null
    }
    Echelle(960.dp, 540.dp, modifier) {
        Bandeau(bandeau.first, bandeau.second, Modifier.align(Alignment.TopCenter).padding(top = 16.dp))
        RangeePortes(valeurs, equipes, ouvertes, enCours, ms = { t.value }, Modifier.align(Alignment.BottomCenter))
        if (enCours != null) {
            val qui = equipes.filter { it.porte == enCours }
            GainsPorte(qui, ms = { t.value }, Modifier.align(Alignment.BottomCenter).padding(bottom = 10.dp))
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
    equipes: List<EquipePortes>,
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
                PucesPorte(equipes.filter { it.porte == k }, Modifier.height(if (equipes.size > 3) 100.dp else 72.dp))
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
private fun PucesPorte(qui: List<EquipePortes>, modifier: Modifier = Modifier) {
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
        Text(nom, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(color = Neon.Blanc, fontSize = taille, fontWeight = FontWeight.Black))
    }
}

/** Les équipes de la porte ouverte, avec leur score qui défile jusqu'au nouveau total. */
@Composable
private fun GainsPorte(qui: List<EquipePortes>, ms: () -> Float, modifier: Modifier = Modifier) {
    val visible by remember { derivedStateOf { ms() >= COMPTE_MS - 300f } }
    if (!visible) return
    Column(
        modifier
            .background(Neon.Nuit2.copy(alpha = 0.85f), RoundedCornerShape(18.dp))
            .border(2.dp, Neon.Or.copy(alpha = 0.7f), RoundedCornerShape(18.dp))
            .padding(horizontal = 18.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (qui.isEmpty()) {
            Text("Personne n'a ouvert cette porte !", style = TextStyle(color = Neon.Blanc.copy(alpha = 0.8f), fontSize = 20.sp, fontWeight = FontWeight.Black))
            return@Column
        }
        // Jusqu'à 8 équipes derrière la même porte : deux colonnes au-delà de 4.
        qui.chunked(if (qui.size > 4) 2 else 1).forEach { ligne ->
            Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                ligne.forEach { e ->
                    val gain = e.apres - e.avant
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        PuceEquipe(e.nom, e.couleur, 150.dp, taille = if (qui.size > 4) 13.sp else 16.sp)
                        Spacer(Modifier.width(10.dp))
                        val score by remember(e) { derivedStateOf { valeurCompteur(e.avant, e.apres, (ms() - COMPTE_MS) / 1_100f) } }
                        Text(
                            espaceMilliers(score),
                            style = TextStyle(color = Neon.Blanc, fontSize = if (qui.size > 4) 16.sp else 20.sp, fontWeight = FontWeight.Black),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            texteValeur(gain),
                            style = TextStyle(color = if (gain < 0) Color.White else Neon.JusteTexte, fontSize = if (qui.size > 4) 13.sp else 16.sp, fontWeight = FontWeight.Black),
                            modifier = Modifier
                                .background(if (gain < 0) Neon.Faux else Neon.JusteClair, RoundedCornerShape(50))
                                .padding(horizontal = 8.dp, vertical = 1.dp),
                        )
                    }
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ Une porte */

private class StylePorte(val haut: Color, val bas: Color, val halo: Color, val motif: DrawScope.() -> Unit)

private val ETOILES = List(14) { i -> val r = java.util.Random(i * 31L + 7); Offset(r.nextFloat(), r.nextFloat()) to (0.6f + r.nextFloat()) }

private val STYLES = listOf(
    // Royale : violet profond, lattes et lueur dorée.
    StylePorte(Color(0xFF7B2FD0), Color(0xFF2C0B5A), Color(0x73FFD166)) {
        val pas = size.width / 9
        for (k in 1..8) drawLine(Color.White.copy(alpha = 0.06f), Offset(k * pas, 0f), Offset(k * pas, size.height), 2f)
        drawCircle(Brush.radialGradient(listOf(Color(0x59FFD166), Color.Transparent), Offset(size.width / 2, size.height * 0.3f), size.width * 0.5f))
    },
    // Bonbon : rayures roses.
    StylePorte(Color(0xFFFF5FB0), Color(0xFFC2186B), Color(0x8CFF5FB0)) {
        val pas = size.width / 5
        var x = -size.height
        while (x < size.width) {
            drawLine(Color.White.copy(alpha = 0.2f), Offset(x, size.height), Offset(x + size.height, 0f), pas * 0.5f)
            x += pas
        }
    },
    // Galaxie : bleu nuit, étoiles et nébuleuse.
    StylePorte(Color(0xFF1B3A8A), Color(0xFF070B2A), Color(0x8C50A0FF)) {
        drawCircle(Brush.radialGradient(listOf(Color(0x8C9B5DE5), Color.Transparent), Offset(size.width * 0.7f, size.height * 0.8f), size.width * 0.6f))
        ETOILES.forEach { (p, r) -> drawCircle(Color.White, r * size.width * 0.012f, Offset(p.x * size.width, p.y * size.height)) }
    },
    // Arc-en-ciel : vert d'eau et arc en bas.
    StylePorte(Color(0xFF0FA58A), Color(0xFF064C45), Color(0x802EE86B)) {
        val couleurs = listOf(Color(0x8CFF5A5F), Color(0x8CFFD166), Color(0x8C2EE86B), Color(0x8C2B86C5))
        couleurs.forEachIndexed { k, c ->
            val r = size.width * (0.62f - k * 0.07f)
            drawArc(c, 180f, 180f, false, Offset(size.width / 2 - r, size.height * 0.95f - r), Size(2 * r, 2 * r), style = Stroke(size.width * 0.06f))
        }
    },
)

/**
 * Une porte mystère (150 × 260) : cadre doré, battant décoré qui s'ouvre sur ses gonds ([ouverture] de 0 à 1),
 * lumière qui filtre dessous, et derrière, le contenu ([contenu] de 0 à 1 pour son apparition).
 */
@Composable
private fun PorteMystere(index: Int, valeur: Int, ouverture: () -> Float, tremble: () -> Boolean, contenu: () -> Float) {
    val style = STYLES[Math.floorMod(index, STYLES.size)]
    val boucle = rememberInfiniteTransition(label = "porte")
    val respire by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(1_800 + index * 230), RepeatMode.Reverse), label = "respire")
    val vibre by boucle.animateFloat(0f, 1f, infiniteRepeatable(tween(90, easing = LinearEasing)), label = "vibre")
    val arche = RoundedCornerShape(topStartPercent = 50, topEndPercent = 50, bottomStartPercent = 4, bottomEndPercent = 4)
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
                // Halo coloré et lumière qui filtre sous la porte.
                drawCircle(Brush.radialGradient(listOf(style.halo, Color.Transparent)), size.width * 0.95f, Offset(size.width / 2, size.height * 0.5f))
                drawOval(
                    Brush.radialGradient(listOf(Color(0xF2FFE696), Color.Transparent)),
                    Offset(size.width * 0.1f, size.height - 6f), Size(size.width * 0.8f, 18f), alpha = 0.55f + 0.45f * respire,
                )
            }
            .clip(arche)
            .background(Brush.linearGradient(listOf(Color(0xFFFFF6DC), Neon.Or, Color(0xFFC9974F), Neon.Or)))
            .padding(9.dp),
    ) {
        val archeInt = RoundedCornerShape(topStartPercent = 50, topEndPercent = 50, bottomStartPercent = 3, bottomEndPercent = 3)
        // Derrière la porte : la lumière et le contenu.
        Box(
            Modifier
                .fillMaxSize()
                .clip(archeInt)
                .background(Brush.radialGradient(listOf(Color(0xFFFFFBE8), Color(0xFFFFE39A), Color(0xFFFF9F43), Color(0xFF7A2C00)))),
            contentAlignment = Alignment.Center,
        ) {
            ContenuPorte(valeur, contenu)
        }
        // Le battant, qui pivote sur ses gonds (bord gauche).
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    val o = ouverture()
                    val e = if (o <= 0f) 0f else 1f - (1f - o) * (1f - o) * (1f - o)
                    transformOrigin = TransformOrigin(0f, 0.5f)
                    cameraDistance = 9f * density
                    rotationY = -108f * e
                    alpha = if (e > 0.93f) 0f else 1f
                }
                .clip(archeInt)
                .background(Brush.linearGradient(listOf(style.haut, style.bas)))
                .drawBehind { style.motif(this) },
        ) {
            Box(
                Modifier
                    .align(Alignment.TopCenter)
                    .offset(y = 32.dp)
                    .size(52.dp)
                    .background(Brush.radialGradient(listOf(Color.White, Neon.Or, Color(0xFFC9974F))), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text("${index + 1}", style = TextStyle(color = Neon.Nuit2, fontSize = 32.sp, fontWeight = FontWeight.Black))
            }
            Text(
                "?",
                style = TextStyle(color = Color.White.copy(alpha = 0.92f), fontSize = 50.sp, fontWeight = FontWeight.Black, shadow = Shadow(Color.White, Offset.Zero, 24f)),
                modifier = Modifier
                    .align(Alignment.Center)
                    .offset(y = 22.dp)
                    .graphicsLayer {
                        val s = 1f + 0.1f * respire
                        scaleX = s
                        scaleY = s
                        alpha = 0.75f + 0.25f * respire
                    },
            )
            Box(
                Modifier
                    .align(Alignment.CenterEnd)
                    .offset(x = (-10).dp, y = 30.dp)
                    .size(13.dp)
                    .background(Brush.radialGradient(listOf(Color.White, Neon.Or, Color(0xFF8A6328))), CircleShape),
            )
        }
    }
}

/** Ce qui jaillit derrière la porte : l'icône (la tuile tombe du toit), le nom et la valeur. */
@Composable
private fun ContenuPorte(valeur: Int, apparition: () -> Float) {
    Column(
        Modifier.graphicsLayer {
            val p = apparition()
            val s = if (p <= 0f) 0f else p + 0.25f * sin(p * PI.toFloat())
            scaleX = s
            scaleY = s
            alpha = if (p <= 0f) 0f else 1f
        },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (valeur < 0) {
            Box(
                Modifier
                    .size(66.dp, 40.dp)
                    .graphicsLayer {
                        val p = apparition()
                        translationY = -260f * (1f - p).coerceAtLeast(0f)
                        rotationZ = -30f * (1f - p)
                    }
                    .clip(RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp, bottomStart = 28.dp, bottomEnd = 28.dp))
                    .background(Brush.verticalGradient(listOf(Color(0xFFE8794A), Color(0xFFB5481F))))
                    .drawBehind {
                        val pas = size.width / 5
                        for (k in 1..4) drawLine(Color.Black.copy(alpha = 0.14f), Offset(k * pas, 0f), Offset(k * pas, size.height), 3f)
                        drawLine(Color.White.copy(alpha = 0.3f), Offset(0f, 3f), Offset(size.width, 3f), 4f)
                    },
            )
        } else {
            Text(iconeContenu(valeur), style = TextStyle(fontSize = 54.sp, lineHeight = 60.sp))
        }
        Spacer(Modifier.height(4.dp))
        Text(
            nomContenu(valeur).uppercase() + " !",
            textAlign = TextAlign.Center,
            style = TextStyle(color = Color(0xFF3B1170), fontSize = 15.sp, fontWeight = FontWeight.Black),
        )
        Text(
            texteValeur(valeur),
            style = TextStyle(
                color = if (valeur < 0) Color(0xFFC3122F) else Color(0xFF0B7A34), fontSize = 34.sp, lineHeight = 36.sp,
                fontWeight = FontWeight.Black, shadow = Shadow(Color.White, Offset(0f, 2f), 0f),
            ),
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
fun ClassementPortes(equipes: List<EquipePortes>, modifier: Modifier = Modifier, jouer: (Son) -> Unit = jouerSon) {
    val evo = remember(equipes) { evolutions(equipes) }
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
private fun LigneClassement(e: EquipePortes, evo: Evolution, i: Int, hauteur: Float, ms: () -> Float, pasRecit: Float) {
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
        Text("${rangMontre + 1}", style = TextStyle(color = Neon.Or, fontSize = taille, fontWeight = FontWeight.Black), modifier = Modifier.width((hauteur * 0.7f).dp))
        Text(e.nom, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(color = Neon.Blanc, fontSize = taille, fontWeight = FontWeight.Black), modifier = Modifier.weight(1f))
        Text(
            texteValeur(gain),
            style = TextStyle(color = if (gain < 0) Color.White else Neon.JusteTexte, fontSize = taille * 0.72f, fontWeight = FontWeight.Black),
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
        Text(espaceMilliers(score), style = TextStyle(color = Neon.Blanc, fontSize = taille, fontWeight = FontWeight.Black), modifier = Modifier.widthIn(min = (hauteur * 1.6f).dp), textAlign = TextAlign.End)
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
                    style = TextStyle(color = encre, fontSize = taille * 0.7f, fontWeight = FontWeight.Black),
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
        Text("RENVERSEMENT !", maxLines = 1, softWrap = false, style = TextStyle(color = Neon.Nuit2, fontSize = 62.sp, lineHeight = 66.sp, fontWeight = FontWeight.Black, letterSpacing = 2.sp))
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
        Text(texte, maxLines = 1, softWrap = false, style = TextStyle(color = Neon.Blanc, fontSize = 26.sp, fontWeight = FontWeight.Black))
        if (accent != null) {
            Text(accent, maxLines = 1, overflow = TextOverflow.Ellipsis, style = TextStyle(color = Color(0xFFFFD166), fontSize = 26.sp, fontWeight = FontWeight.Black))
        }
    }
}
