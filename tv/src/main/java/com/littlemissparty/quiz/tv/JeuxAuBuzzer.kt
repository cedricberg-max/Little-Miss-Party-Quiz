package com.littlemissparty.quiz.tv

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import android.graphics.BitmapFactory
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.tv.habillage.CarteIndice
import com.littlemissparty.quiz.tv.habillage.ChanteEnseigne
import com.littlemissparty.quiz.tv.habillage.Look
import com.littlemissparty.quiz.tv.habillage.panneauJeu
import com.littlemissparty.quiz.tv.habillage.PoliceLmp
import com.littlemissparty.quiz.tv.habillage.RevelationPersonnage
import com.littlemissparty.quiz.tv.habillage.apparition

/** Petit badge doré en haut d'un plateau de mini-jeu. */
@Composable
private fun Badge(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        color = Palette.Night, fontSize = 18.sp, fontWeight = FontWeight.Black,
        modifier = modifier.clip(RoundedCornerShape(50)).background(Palette.Gold).padding(horizontal = 14.dp, vertical = 4.dp),
    )
}

/**
 * Chante le mot ! : le mot en très grand, entouré de notes qui dansent. Il reste affiché pendant que
 * l'équipe chante, et à la révélation.
 */
@Composable
fun ChanteBoard(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    // Game Show : l'enseigne néon (proposition F, choisie le 25/10), sans badge ni notes.
    if (Look.gs) { ChanteEnseigne(q.text.uppercase(), q.id, modifier); return }
    val danse = rememberInfiniteTransition(label = "notes")
    val haut by danse.animateFloat(
        0f, 1f,
        infiniteRepeatable(tween(900, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "note",
    )
    Box(
        modifier.panneauJeu(),
        contentAlignment = Alignment.Center,
    ) {
        Badge("CHANTE LE MOT !", Modifier.align(Alignment.TopCenter).padding(top = 12.dp))
        Text(
            "♪", color = Palette.Gold, fontSize = 64.sp,
            modifier = Modifier.align(Alignment.CenterStart).padding(start = 36.dp).graphicsLayer { translationY = -24f * haut },
        )
        Text(
            "♫", color = Palette.Gold, fontSize = 64.sp,
            modifier = Modifier.align(Alignment.CenterEnd).padding(end = 36.dp).graphicsLayer { translationY = -24f * (1f - haut) },
        )
        MotEnGrand(q.text.uppercase(), Modifier.padding(horizontal = 110.dp).apparition(0, q.id))
    }
}

/**
 * Mot à chanter en très grand, réduit juste assez pour que chaque mot tienne sur une ligne : jamais
 * « AMOU / R » coupé en deux. Une expression de plusieurs mots passe à la ligne entre les mots.
 */
@Composable
private fun MotEnGrand(mot: String, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val mesure = rememberTextMeasurer()
        val largeur = constraints.maxWidth
        val borne = constraints.hasBoundedWidth
        val taille = remember(mot, largeur, borne) {
            val style = TextStyle(fontFamily = PoliceLmp, fontSize = MOT_TAILLE_MAX.sp, fontWeight = FontWeight.Black)
            val plusLong = if (borne) mot.split(' ').maxOf { mesure.measure(it, style, softWrap = false, maxLines = 1).size.width } else 0
            // Petite marge : la mesure et l'affichage peuvent différer d'un pixel.
            if (plusLong <= 0) MOT_TAILLE_MAX
            else (MOT_TAILLE_MAX * largeur * 0.96f / plusLong).coerceIn(MOT_TAILLE_MIN, MOT_TAILLE_MAX)
        }
        Text(
            mot,
            color = Palette.Ink, fontSize = taille.sp, lineHeight = (taille * 1.08f).sp, fontWeight = FontWeight.Black,
            textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
    }
}

private const val MOT_TAILLE_MAX = 96f
private const val MOT_TAILLE_MIN = 36f

/**
 * Qui suis-je ? : les indices apparaissent un à un au fil du chrono (figés pendant une réponse orale) ;
 * à la révélation, tous les indices et l'émoji du personnage. Les indices restent centrés dans le cadre et
 * se réduisent juste assez pour que le dernier ne soit jamais coupé, de 1 à 8 équipes.
 */
@Composable
fun QuiSuisBoard(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val remaining = chronoRestant(q, state)
    val revealed = state.phase == Phase.REVEAL || state.phase == Phase.SCORES
    val shown = if (revealed || state.phase == Phase.CLOSED) q.cards.size else q.cluesShown(q.durationMs - remaining)
    val aide = shown < q.cards.size
    Column(
        modifier.panneauJeu().padding(horizontal = 28.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Badge("QUI SUIS-JE ?")
            Spacer(Modifier.weight(1f))
            if (!revealed) Text("?", color = Palette.Gold, fontSize = 44.sp, fontWeight = FontWeight.Black)
        }
        // Révélation : le personnage en grand, avec son image (préparée dans l'administration), son émoji ou son nom seul.
        if (revealed) {
            RevelationPersonnage(
                nom = q.choices.getOrNull(q.correct).orEmpty(),
                emoji = q.emoji?.takeIf { it.isNotBlank() },
                image = imagePersonnage(q, state),
                modifier = Modifier.weight(1f).fillMaxWidth(),
                // Game Show : le nom est déjà en néon dans la révélation à côté, pas deux fois à l'écran.
                avecNom = !Look.gs,
            )
            return@Column
        }
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            val mesure = rememberTextMeasurer()
            val densite = LocalDensity.current
            val indices = q.cards.take(shown).map { it.word }
            val hauteur = constraints.maxHeight
            // Cartes néon (choix de cedric) : pastille numérotée de 1,45 × la taille du texte, marges et bordure de la carte.
            val taille = remember(indices, aide, constraints.maxWidth, hauteur, densite.density) {
                fun style(t: Float) = TextStyle(fontFamily = PoliceLmp, fontSize = t.sp, lineHeight = (t * 1.15f).sp, fontWeight = FontWeight.ExtraBold)
                var t = INDICE_TAILLE_MAX
                while (t > INDICE_TAILLE_MIN) {
                    val largeur = (constraints.maxWidth - with(densite) { (58f + t * 1.45f).dp.roundToPx() }).coerceAtLeast(1)
                    val total = indices.sumOf {
                        maxOf(
                            mesure.measure(it, style(t), constraints = Constraints(maxWidth = largeur)).size.height,
                            with(densite) { (t * 1.45f).dp.roundToPx() },
                        ) + with(densite) { 26.dp.roundToPx() }
                    } + with(densite) { (10.dp * (indices.size - 1).coerceAtLeast(0)).roundToPx() + (if (aide) 34.dp else 0.dp).roundToPx() }
                    if (!constraints.hasBoundedHeight || total <= hauteur) break
                    t -= 1f
                }
                t
            }
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically)) {
                indices.forEachIndexed { i, clue ->
                    key(q.id, i) { CarteIndice(i + 1, clue, Modifier.fillMaxWidth(), taille.sp) }
                }
                if (aide) {
                    Text(
                        "Prochain indice dans un instant…",
                        color = Palette.InkSoft, fontSize = 20.sp, modifier = Modifier.padding(start = 56.dp),
                    )
                }
            }
        }
    }
}

/** Image du personnage de Qui suis-je ?, une fois chargée sur la box ; null sinon. */
@Composable
private fun imagePersonnage(q: Question, state: UiState.Playing): ImageBitmap? {
    val bytes = q.imageId?.let { state.images[it] }
    return remember(bytes) { bytes?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }.getOrNull() } }
}

private const val INDICE_TAILLE_MAX = 30f
private const val INDICE_TAILLE_MIN = 18f
