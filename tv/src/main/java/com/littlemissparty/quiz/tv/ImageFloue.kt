package com.littlemissparty.quiz.tv

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.tv.habillage.GS
import com.littlemissparty.quiz.tv.habillage.Look
import com.littlemissparty.quiz.tv.habillage.RevelationNeon
import com.littlemissparty.quiz.tv.habillage.apparition
import com.littlemissparty.quiz.tv.habillage.panneauJeu
import kotlinx.coroutines.delay

/**
 * Largeurs successives de la photo, de la plus floue à la plus nette. Le flou vient de l'agrandissement
 * lissé d'une toute petite image : il marche sur toutes les box, même en Android 9 où le flou de Compose
 * n'existe pas, et ne coûte presque rien.
 */
private val NIVEAUX = listOf(5, 8, 12, 18, 26, 38, 56, 80, 120, 170)

/**
 * Temps restant du chrono de la question, mis à jour en continu ; figé pendant une pause, pendant le
 * décompte de reprise et pendant la réponse orale d'une équipe qui a buzzé (la box n'a plus d'échéance).
 */
@Composable
fun chronoRestant(q: Question, state: UiState.Playing): Long {
    var remaining by remember(q.id) { mutableLongStateOf(state.remainingMs) }
    LaunchedEffect(q.id, state.deadline, state.paused, state.phase) {
        val deadline = state.deadline
        if (deadline == null) {
            remaining = state.remainingMs
            return@LaunchedEffect
        }
        val start = state.resumeAt ?: 0L
        while (true) {
            remaining = (deadline - maxOf(System.currentTimeMillis() + state.serverOffset, start)).coerceAtLeast(0)
            if (remaining == 0L) break
            delay(80)
        }
    }
    return remaining
}

/**
 * Image floue : la photo devient de plus en plus nette au fil du chrono ; elle se fige quand une équipe
 * buzze (le chrono attend le verdict de l'animatrice) et apparaît enfin nette à la révélation.
 */
@Composable
fun FlouPhoto(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val bytes = q.imageId?.let { state.images[it] }
    val photo: Bitmap? = remember(bytes) {
        bytes?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size) }.getOrNull() }
    }
    val niveaux: List<ImageBitmap> = remember(photo) {
        val p = photo ?: return@remember emptyList()
        NIVEAUX.map { w ->
            val largeur = w.coerceAtMost(p.width)
            val hauteur = (p.height * largeur / p.width.toFloat()).toInt().coerceAtLeast(1)
            Bitmap.createScaledBitmap(p, largeur, hauteur, true).asImageBitmap()
        }
    }
    val nette = remember(photo) { photo?.asImageBitmap() }
    val total = q.durationMs.coerceAtLeast(1)
    val remaining = chronoRestant(q, state)
    val revealed = state.phase == Phase.REVEAL || state.phase == Phase.SCORES
    val progress = (1f - remaining.toFloat() / total).coerceIn(0f, 1f)
    // Lent au début, plus rapide vers la fin : l'image reste mystérieuse un bon moment.
    val cible = if (revealed) NIVEAUX.size.toFloat() else (NIVEAUX.size - 1) * progress * progress
    val niveau by animateFloatAsState(
        cible,
        animationSpec = if (revealed) tween(1_200, easing = FastOutSlowInEasing) else tween(120, easing = LinearEasing),
        label = "flou",
    )
    Box(
        modifier.clip(RoundedCornerShape(28.dp)).background(Color.White.copy(alpha = 0.12f)),
        contentAlignment = Alignment.Center,
    ) {
        if (nette != null && niveaux.isNotEmpty()) {
            // Fondu entre deux niveaux voisins : la photo se précise en douceur, sans à-coups.
            val pile = niveaux + nette
            val bas = niveau.toInt().coerceIn(0, pile.size - 1)
            val haut = (bas + 1).coerceAtMost(pile.size - 1)
            val t = (niveau - bas).coerceIn(0f, 1f)
            Image(
                pile[bas], contentDescription = "Image floue", contentScale = ContentScale.Crop,
                filterQuality = FilterQuality.Low, modifier = Modifier.fillMaxSize(),
            )
            if (haut != bas && t > 0.01f) {
                Image(
                    pile[haut], contentDescription = null, contentScale = ContentScale.Crop,
                    filterQuality = FilterQuality.Low, alpha = t, modifier = Modifier.fillMaxSize(),
                )
            }
        } else {
            Text("?", color = Palette.Gold, fontSize = 140.sp, fontWeight = FontWeight.Black)
        }
        // Game Show : le titre est déjà dans l'enseigne, plus de pastille en double (cedric, planche du 27/10).
        if (!revealed && !Look.gs) {
            Text(
                "IMAGE FLOUE",
                color = Palette.Night, fontSize = 18.sp, fontWeight = FontWeight.Black,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 12.dp)
                    .clip(RoundedCornerShape(50)).background(Palette.Gold).padding(horizontal = 14.dp, vertical = 4.dp),
            )
        }
    }
}

/** Panneau des jeux au buzzer (image floue, chante le mot, qui suis-je) : consigne, équipe qui a buzzé, équipes déjà passées, puis la réponse. */
@Composable
fun FlouPanel(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val buzzer = state.teams.find { it.uid == state.buzzTeam }
    val passees = state.teams.filter { it.uid in state.buzzBlocked }
    val gagnant = state.teams.find { (state.awards[it.uid]?.points ?: 0) > 0 }
    Column(
        modifier.panneauJeu(0.08f).padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        when {
            // Game Show : la révélation en néon, le mot dans son tube (cedric, 25/10 au soir : « plus festif, plus néon »).
            (state.phase == Phase.REVEAL || state.phase == Phase.SCORES) && Look.gs -> RevelationNeon(
                etiquette = if (q.isChante) "Le mot :" else "C'était :",
                mot = q.choices.getOrNull(q.correct).orEmpty(),
                phrase = when {
                    gagnant != null && q.isChante -> "Bravo ${gagnant.name}, quelle voix !"
                    gagnant != null -> "Bravo ${gagnant.name} !"
                    q.isChante -> "Personne n'a chanté, ce n'est pas grave !"
                    else -> "Personne n'a trouvé, ce n'est pas grave !"
                },
                teinte = gagnant?.color?.toColor() ?: GS.Rose,
                cle = state.question?.id,
                modifier = Modifier.fillMaxSize(),
            )
            state.phase == Phase.REVEAL || state.phase == Phase.SCORES -> {
                Text(if (q.isChante) "Le mot :" else "C'était :", color = Palette.InkSoft, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                // Le mot entier, jamais coupé (« Téléphériqu / e », 25/10) : il rétrécit selon sa longueur, et la phrase
                // dessous garde toujours sa place, entière, à 8 équipes comme à 1.
                TexteAjuste(
                    q.choices.getOrNull(q.correct).orEmpty(), color = Palette.Gold, max = 52.sp, min = 22.sp, lignes = 2,
                    modifier = Modifier.fillMaxWidth().weight(1f, fill = false).apparition(0, state.phase),
                )
                Spacer(Modifier.height(20.dp))
                TexteAjuste(
                    when {
                        gagnant != null && q.isChante -> "Bravo ${gagnant.name}, quelle voix !"
                        gagnant != null -> "Bravo ${gagnant.name} !"
                        q.isChante -> "Personne n'a chanté, ce n'est pas grave !"
                        else -> "Personne n'a trouvé, ce n'est pas grave !"
                    },
                    color = gagnant?.color?.toColor() ?: Palette.Ink, max = 30.sp, min = 16.sp, lignes = 3,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            buzzer != null -> {
                Text(
                    "${buzzer.name} a buzzé !",
                    color = buzzer.color.toColor(), fontSize = 46.sp, lineHeight = 52.sp, fontWeight = FontWeight.Black,
                    textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.apparition(0, buzzer.uid),
                )
                Spacer(Modifier.height(14.dp))
                Text(if (q.isChante) "À vous de chanter !" else if (q.isBlind) "Le titre, à voix haute !" else "Votre réponse, à voix haute !", color = Palette.Ink, fontSize = 28.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            }
            state.phase == Phase.CLOSED -> Text(
                if (q.isFlou) "Temps écoulé ! Voyons ce qui se cachait…" else if (q.isBlind) "Temps écoulé ! Écoutons la réponse…" else "Temps écoulé !",
                color = Palette.Gold, fontSize = 32.sp, lineHeight = 38.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
            )
            q.isDisparu && etapeDisparu(q, state) != EtapeDisparu.CHERCHER -> Text(
                "Mémorisez bien tous les objets !",
                color = Palette.Ink, fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
            )
            else -> Text(
                when {
                    q.isDisparu -> "Buzzez dès que vous savez quel objet a disparu !"
                    q.isChante -> "Buzzez et chantez une chanson avec ce mot !"
                    q.isQuiSuis -> "Buzzez dès que vous savez qui je suis !"
                    q.isBlind -> "Buzzez dès que vous reconnaissez la chanson !"
                    else -> "Buzzez dès que vous reconnaissez l'image !"
                },
                color = Palette.Ink, fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
            )
        }
        if (passees.isNotEmpty() && state.phase == Phase.QUESTION) {
            Spacer(Modifier.height(24.dp))
            Text(
                "Déjà essayé : " + passees.joinToString(", ") { it.name },
                color = Palette.InkSoft, fontSize = 22.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                // Jusqu'à 7 équipes déjà passées : deux lignes au plus, la fin s'efface en « … ».
                maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
