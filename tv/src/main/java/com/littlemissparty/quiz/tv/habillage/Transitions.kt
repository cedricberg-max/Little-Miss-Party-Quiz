package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.QuestionKind
import com.littlemissparty.quiz.tv.Team
import com.littlemissparty.quiz.tv.UiState
import com.littlemissparty.quiz.tv.toColor

/**
 * Habillage posé par-dessus les écrans du jeu : le rideau qui annonce chaque nouveau jeu et le bandeau
 * qui présente l'équipe qui va mimer. Purement visuel : rien n'attend ces animations, la partie continue
 * dessous, et rien ici ne prend le focus de la télécommande ni n'apparaît aux tests d'écran.
 */
@Composable
fun HabillageEcran(state: UiState.Playing) {
    TransitionDeJeu(state)
    AnnonceEquipe(state)
}

private class Annonce(val id: String, val surtitre: String, val titre: String, val dureeMs: Long)

/**
 * Rideau de changement de jeu, façon émission de télé : deux panneaux se ferment, le nom du jeu claque sur
 * le logo aux cuivres (jingle [Son.TRANSITION]), puis le rideau s'ouvre sur le jeu.
 * Court sur une question de quiz (le chrono tourne déjà), plus long sur l'accueil des mimes, qui attend la régie.
 */
@Composable
private fun TransitionDeJeu(state: UiState.Playing) {
    val q = state.question?.takeIf { state.phase == Phase.QUESTION }
    val cle = q?.let(::epreuveDe)
    var annonce by remember { mutableStateOf<Annonce?>(null) }
    LaunchedEffect(state.code, cle) {
        if (q == null || cle == null) return@LaunchedEffect
        val avant = Habillage.epreuvesVues.put(state.code, cle)
        // Même jeu, ou box qui se reconnecte en plein jeu : pas de rideau.
        if (avant == cle || (avant == null && state.index != 0)) return@LaunchedEffect
        val mimes = q.kind == QuestionKind.MIME
        annonce = Annonce(
            id = "${state.code} $cle ${state.index}",
            surtitre = when {
                avant == null -> "C'EST PARTI !"
                !mimes && (avant.startsWith("quiz") || avant.startsWith("manche")) -> "NOUVELLE MANCHE"
                else -> "JEU SUIVANT"
            },
            titre = when {
                mimes -> "Les Mimes !"
                q.kind == QuestionKind.NUMBER -> "Le Juste Chiffre !"
                q.isFlou -> "L'Image floue !"
                q.isChante -> "Chante le mot !"
                q.isQuiSuis -> "Qui suis-je ?"
                q.isBlind -> "Blind test !"
                q.isStatues -> "Statues musicales !"
                q.isDisparu -> "Qui a disparu ?"
                else -> q.roundTitle?.takeIf { it.isNotBlank() } ?: when {
                    q.isExpress -> "Vrai ou Faux express !"
                    q.isZoom -> "Zoom mystère !"
                    else -> "Le Quiz !"
                }
            },
            dureeMs = when {
                mimes -> Tempo.TRANSITION_RIDEAU
                q.isExpress -> RIDEAU_EXPRESS_MS
                else -> RIDEAU_QUIZ_MS
            },
        )
    }
    val a = annonce ?: return
    key(a.id) { Rideau(a) { annonce = null } }
}

@Composable
private fun Rideau(a: Annonce, fini: () -> Unit) {
    val t = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        t.animateTo(a.dureeMs.toFloat(), tween(a.dureeMs.toInt(), easing = LinearEasing))
        fini()
    }
    val ms = { t.value }
    val fermeture = {
        val v = ms()
        when {
            v < FERMETURE_MS -> FastOutSlowInEasing.transform(v / FERMETURE_MS)
            v > a.dureeMs - OUVERTURE_MS -> 1f - FastOutSlowInEasing.transform(((v - (a.dureeMs - OUVERTURE_MS)) / OUVERTURE_MS).coerceIn(0f, 1f))
            else -> 1f
        }
    }
    val titre = { rebond(((ms() - 250f) / 450f).coerceIn(0f, 1f)) }
    val eclat by remember { derivedStateOf { t.value >= Tempo.TRANSITION_IMPACT - 150 } }
    Box(Modifier.fillMaxSize().clearAndSetSemantics {}) {
        Row(Modifier.fillMaxSize()) {
            Panneau(Modifier.weight(1f).graphicsLayer { translationX = -(1f - fermeture()) * size.width }, bordADroite = true)
            Panneau(Modifier.weight(1f).graphicsLayer { translationX = (1f - fermeture()) * size.width }, bordADroite = false)
        }
        Gerbe(cle = a.id, actif = eclat)
        Column(
            Modifier.fillMaxSize().graphicsLayer { alpha = minOf(fermeture(), titre() * 2f).coerceIn(0f, 1f) },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Filet(Modifier.graphicsLayer { scaleX = titre().coerceIn(0f, 1f); transformOrigin = TransformOrigin(1f, 0.5f) })
                Text(
                    a.surtitre, color = Neon.Or, fontSize = 22.sp, fontWeight = FontWeight.Black, letterSpacing = 8.sp,
                    maxLines = 1, softWrap = false, modifier = Modifier.padding(horizontal = 18.dp),
                )
                Filet(Modifier.graphicsLayer { scaleX = titre().coerceIn(0f, 1f); transformOrigin = TransformOrigin(0f, 0.5f) })
            }
            Spacer(Modifier.height(14.dp))
            val taille = when {
                a.titre.length <= 16 -> 88.sp
                a.titre.length <= 26 -> 64.sp
                else -> 48.sp
            }
            Text(
                a.titre,
                style = TextStyle(fontFamily = PoliceLmp,
                    brush = Brush.verticalGradient(listOf(Neon.OrClair, Neon.Or, Neon.OrProfond)),
                    fontSize = taille, lineHeight = taille * 1.1f, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                    shadow = Shadow(Neon.Or.copy(alpha = 0.6f), blurRadius = 30f),
                ),
                maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 60.dp).graphicsLayer {
                    val s = 0.6f + 0.4f * titre()
                    scaleX = s; scaleY = s
                },
            )
            // Le logo, en signature sous le nom du jeu.
            Spacer(Modifier.height(18.dp))
            LogoMarque(46.dp, Modifier.graphicsLayer { alpha = 0.85f * titre().coerceIn(0f, 1f) })
        }
    }
}

/**
 * Moitié du rideau : velours violet qui s'éclaircit vers le milieu, plis doux. Les deux panneaux se rejoignent
 * sur le même violet opaque et se chevauchent un peu : fermé, le rideau ne montre ni fente ni trait clair
 * (cedric, 19 octobre : l'ancien rideau, sans le raccord blanc).
 */
@Composable
internal fun Panneau(modifier: Modifier, bordADroite: Boolean) {
    Box(
        modifier.fillMaxHeight().drawWithCache {
            val w = size.width
            val recouvre = 3.dp.toPx()
            val gauche = if (bordADroite) 0f else -recouvre
            val large = w + recouvre
            val milieu = lerp(Neon.Nuit, Neon.Violet, 0.95f)
            // Le violet le plus clair forme un palier au milieu (pas une arête), pour que la jonction ne se voie pas.
            val fond = if (bordADroite) {
                Brush.horizontalGradient(0f to Neon.Nuit, 0.5f to Neon.Nuit2, 0.85f to milieu, 1f to milieu, startX = gauche, endX = gauche + large)
            } else {
                Brush.horizontalGradient(0f to milieu, 0.15f to milieu, 0.5f to Neon.Nuit2, 1f to Neon.Nuit, startX = gauche, endX = gauche + large)
            }
            val plis = Brush.horizontalGradient(
                List(9) { i -> if (i % 2 == 0) Color.Transparent else Color.Black.copy(alpha = 0.18f) },
                startX = gauche, endX = gauche + large,
            )
            onDrawBehind {
                drawRect(fond, Offset(gauche, 0f), androidx.compose.ui.geometry.Size(large, size.height))
                drawRect(plis, Offset(gauche, 0f), androidx.compose.ui.geometry.Size(large, size.height))
            }
        },
    )
}

@Composable
private fun Filet(modifier: Modifier) {
    Box(modifier.width(90.dp).height(2.dp).background(Brush.horizontalGradient(listOf(Neon.Or.copy(alpha = 0f), Neon.Or, Neon.Or.copy(alpha = 0f)))))
}

/** Petit rebond à l'arrivée (léger dépassement, puis retour à 1). */
private fun rebond(p: Float): Float {
    val c = 1.9f
    val x = p - 1f
    return 1f + (c + 1f) * x * x * x + c * x * x
}

/**
 * Bandeau de présentation de l'équipe qui va mimer, en bas de l'écran comme à la télé : il glisse à
 * l'arrivée du tour, sur le coup de sifflet, puis s'efface. Une seule fois par tour, même si la box se reconnecte.
 */
@Composable
private fun AnnonceEquipe(state: UiState.Playing) {
    val m = state.mime ?: return
    val team = state.teams.find { it.uid == m.team } ?: return
    val id = "${state.code} ${team.uid} ${m.turns.size}"
    var montrer by remember(id) { mutableStateOf(false) }
    LaunchedEffect(id) { montrer = Habillage.equipesAnnoncees.add(id) }
    if (montrer) key(id) { Bandeau(team) { montrer = false } }
}

@Composable
private fun Bandeau(team: Team, fini: () -> Unit) {
    val t = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        t.animateTo(BANDEAU_MS.toFloat(), tween(BANDEAU_MS.toInt(), easing = LinearEasing))
        fini()
    }
    val entree = { FastOutSlowInEasing.transform((t.value / 380f).coerceIn(0f, 1f)) }
    val sortie = { FastOutSlowInEasing.transform(((t.value - (BANDEAU_MS - 400f)) / 400f).coerceIn(0f, 1f)) }
    val couleur = team.color.toColor()
    Box(Modifier.fillMaxSize().clearAndSetSemantics {}, contentAlignment = Alignment.BottomStart) {
        Row(
            Modifier.padding(bottom = 92.dp)
                .widthIn(max = 720.dp)
                .graphicsLayer {
                    translationX = -(1f - entree()) * size.width + sortie() * size.width * 1.2f
                    alpha = 1f - sortie()
                }
                .clip(RoundedCornerShape(topEnd = 40.dp, bottomEnd = 40.dp))
                .background(Brush.horizontalGradient(listOf(couleur.copy(alpha = 0.95f), Neon.Nuit2.copy(alpha = 0.95f)), endX = 520f))
                .padding(start = 56.dp, end = 44.dp, top = 14.dp, bottom = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.width(8.dp).height(64.dp).clip(RoundedCornerShape(4.dp)).background(Neon.Or))
            Spacer(Modifier.width(20.dp))
            Column {
                Text("À VOUS DE MIMER !", color = Neon.Or, fontSize = 18.sp, fontWeight = FontWeight.Black, letterSpacing = 5.sp, maxLines = 1, softWrap = false)
                Text(
                    team.name, color = Neon.Blanc, fontSize = 40.sp, lineHeight = 46.sp, fontWeight = FontWeight.Black,
                    maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

private const val FERMETURE_MS = 280f
private const val OUVERTURE_MS = 400f
/** Le rideau d'une manche de quiz : 1,7 s, dont à peine plus d'une seconde plein écran. */
private const val RIDEAU_QUIZ_MS = 1_700L
/** En express le chrono ne dure que 7 à 12 s : rideau encore plus bref. */
private const val RIDEAU_EXPRESS_MS = 1_300L
private const val BANDEAU_MS = 2_800L
