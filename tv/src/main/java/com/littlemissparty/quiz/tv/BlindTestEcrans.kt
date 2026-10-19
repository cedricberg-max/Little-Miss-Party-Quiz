package com.littlemissparty.quiz.tv

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
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
import com.littlemissparty.quiz.tv.habillage.apparition
import com.littlemissparty.quiz.tv.habillage.rebond

/** Pochette du morceau (photo choisie dans l'admin), une fois chargée sur la box ; null sinon. */
@Composable
fun pochette(q: Question, state: UiState.Playing): ImageBitmap? {
    val bytes = q.imageId?.let { state.images[it] }
    return remember(bytes) { bytes?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }.getOrNull() } }
}

/** Blind test révélé : la pochette au centre, à la place du disque. */
@Composable
fun BlindPochette(image: ImageBitmap, cle: Any?, modifier: Modifier = Modifier) {
    Image(
        image, contentDescription = "Pochette du morceau", contentScale = ContentScale.Crop,
        modifier = modifier.apparition(0, cle).rebond(true, 0.06f).clip(RoundedCornerShape(24.dp)).border(6.dp, Palette.Gold, RoundedCornerShape(24.dp)),
    )
}

/**
 * Blind test, à côté du disque : où en est le morceau (numéro, valeur, points doublés), l'équipe qui a buzzé et
 * attend le verdict, la musique en attente de relance, puis à la révélation le titre, l'artiste et les points.
 */
@Composable
fun BlindPanel(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val b = state.blind
    val buzzer = state.teams.find { it.uid == state.buzzTeam }
    val passees = state.teams.filter { it.uid in state.buzzBlocked }
    val gagnant = state.teams.find { (state.awards[it.uid]?.points ?: 0) > 0 }
    val revele = state.phase == Phase.REVEAL || state.phase == Phase.SCORES
    Column(
        modifier.clip(RoundedCornerShape(28.dp)).background(Color.White.copy(alpha = 0.08f)).padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // À la révélation, le panneau garde sa hauteur pour le titre et le gagnant (960 × 540 dp sur la box) :
        // la valeur du morceau est dans le « +N ».
        if (b != null && !revele) {
            Text("Morceau ${b.numero} / ${b.total}", color = Palette.InkSoft, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Text(
                if (b.doubled) "POINTS DOUBLÉS · ${b.points} points" else "${b.points} points",
                color = if (b.doubled) Palette.Night else Palette.Gold, fontSize = 22.sp, fontWeight = FontWeight.Black,
                modifier = Modifier.padding(top = 6.dp).clip(RoundedCornerShape(50))
                    .background(if (b.doubled) Palette.Gold else Color.Transparent).padding(horizontal = 14.dp, vertical = 4.dp)
                    .apparition(0, b.numero),
            )
            Spacer(Modifier.height(18.dp))
        }
        when {
            revele -> {
                Text("C'était…", color = Palette.InkSoft, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text(
                    q.choices.getOrNull(q.correct).orEmpty(),
                    color = Palette.Gold, fontSize = 34.sp, lineHeight = 38.sp, fontWeight = FontWeight.Black,
                    textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.apparition(300, q.id),
                )
                q.artist?.takeIf { it.isNotBlank() }?.let {
                    Text(
                        it, color = Palette.Ink, fontSize = 24.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.apparition(700, q.id),
                    )
                }
                Spacer(Modifier.height(10.dp))
                if (gagnant != null) {
                    Text(
                        "Bonne réponse ! Bravo ${gagnant.name}",
                        color = gagnant.color.toColor(), fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.Black,
                        textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.apparition(1100, q.id),
                    )
                    Text(
                        "+${state.awards[gagnant.uid]?.points ?: 0}",
                        color = Palette.Gold, fontSize = 40.sp, fontWeight = FontWeight.Black,
                        modifier = Modifier.apparition(1400, q.id).rebond(true, 0.12f),
                    )
                } else {
                    Text(
                        "Personne n'a trouvé, ce n'est pas grave !", color = Palette.Ink, fontSize = 22.sp, lineHeight = 28.sp,
                        fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.apparition(1100, q.id),
                    )
                }
            }
            buzzer != null -> {
                Text(
                    "${buzzer.name} a buzzé !",
                    color = buzzer.color.toColor(), fontSize = 46.sp, lineHeight = 52.sp, fontWeight = FontWeight.Black,
                    textAlign = TextAlign.Center, modifier = Modifier.apparition(0, buzzer.uid),
                )
                Spacer(Modifier.height(14.dp))
                Text("On attend sa réponse…", color = Palette.Ink, fontSize = 30.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            }
            b != null && b.waiting && !b.played -> Text(
                "Prêts ? Écoutez bien…", color = Palette.Ink, fontSize = 36.sp, lineHeight = 42.sp, fontWeight = FontWeight.Black,
                textAlign = TextAlign.Center, modifier = Modifier.apparition(0, "pret"),
            )
            b != null && b.waiting && passees.isNotEmpty() -> Text(
                "Pas tout à fait ! La musique va repartir…", color = Palette.Ink, fontSize = 32.sp, lineHeight = 38.sp,
                fontWeight = FontWeight.Black, textAlign = TextAlign.Center, modifier = Modifier.apparition(0, passees.size),
            )
            b != null && b.waiting -> Text(
                "Musique en pause…", color = Palette.Ink, fontSize = 32.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
            )
            else -> Text(
                "Buzzez dès que vous reconnaissez la chanson !",
                color = Palette.Ink, fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
            )
        }
        if (passees.isNotEmpty() && state.phase == Phase.QUESTION) {
            Spacer(Modifier.height(20.dp))
            Text(
                "Déjà essayé : " + passees.joinToString(", ") { it.name },
                color = Palette.InkSoft, fontSize = 22.sp, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
