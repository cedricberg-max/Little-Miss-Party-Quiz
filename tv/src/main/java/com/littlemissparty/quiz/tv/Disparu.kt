package com.littlemissparty.quiz.tv

import android.graphics.BitmapFactory
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.MimeCard
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.tv.habillage.apparition

/** Qui a disparu ? : où en est la question, d'après le chrono. */
enum class EtapeDisparu { MEMORISER, MAGIE, CHERCHER, REPONSE }

@Composable
fun etapeDisparu(q: Question, state: UiState.Playing): EtapeDisparu {
    if (state.phase == Phase.REVEAL || state.phase == Phase.SCORES) return EtapeDisparu.REPONSE
    if (state.phase == Phase.CLOSED) return EtapeDisparu.CHERCHER
    val ecoule = q.durationMs - chronoRestant(q, state)
    return when {
        ecoule < q.memoMs -> EtapeDisparu.MEMORISER
        ecoule < q.buzzFromMs -> EtapeDisparu.MAGIE
        else -> EtapeDisparu.CHERCHER
    }
}

/**
 * Qui a disparu ? : la grille d'objets à mémoriser, le tour de magie (objets retournés), puis la même grille
 * avec un trou « ? » à la place de l'objet disparu. À la révélation, l'objet réapparaît en or.
 */
@Composable
fun DisparuBoard(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val etape = etapeDisparu(q, state)
    val anim = rememberInfiniteTransition(label = "magie")
    val tourne by anim.animateFloat(-8f, 8f, infiniteRepeatable(tween(260, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "tourne")
    Column(
        modifier.clip(RoundedCornerShape(28.dp)).background(Color.White.copy(alpha = 0.10f)).padding(horizontal = 24.dp, vertical = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            when (etape) {
                EtapeDisparu.MEMORISER -> "MÉMORISEZ !"
                EtapeDisparu.MAGIE -> "ABRACADABRA…"
                EtapeDisparu.CHERCHER -> "QUI A DISPARU ?"
                EtapeDisparu.REPONSE -> "QUI A DISPARU ?"
            },
            color = Palette.Night, fontSize = 18.sp, fontWeight = FontWeight.Black,
            modifier = Modifier.clip(RoundedCornerShape(50)).background(Palette.Gold).padding(horizontal = 14.dp, vertical = 4.dp)
                .apparition(0, etape),
        )
        Spacer(Modifier.height(10.dp))
        // Colonnes choisies pour remplir les lignes ; une dernière ligne incomplète est centrée, jamais un trou d'un côté.
        val colonnes = when (q.cards.size) {
            in 1..4 -> 2
            in 5..6, 9 -> 3
            else -> 4
        }
        Column(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            q.cards.indices.chunked(colonnes).forEach { ligne ->
                Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    val vide = colonnes - ligne.size
                    if (vide > 0) Spacer(Modifier.weight(vide / 2f))
                    ligne.forEach { i ->
                        val disparu = i == q.missingIndex
                        ObjetCase(
                            q.cards[i], q.cards[i].imageId?.let { state.images[it] }, etape, disparu,
                            Modifier.weight(1f).fillMaxHeight().graphicsLayer { if (etape == EtapeDisparu.MAGIE) rotationZ = if (i % 2 == 0) tourne else -tourne },
                        )
                    }
                    if (vide > 0) Spacer(Modifier.weight(vide / 2f))
                }
            }
        }
    }
}

@Composable
private fun ObjetCase(carte: MimeCard, octets: ByteArray?, etape: EtapeDisparu, disparu: Boolean, modifier: Modifier) {
    val photo = photoCarte(octets, 240)
    val trou = disparu && etape == EtapeDisparu.CHERCHER
    val enOr = disparu && etape == EtapeDisparu.REPONSE
    Box(
        modifier.clip(RoundedCornerShape(18.dp))
            .background(
                when {
                    enOr -> Palette.Gold.copy(alpha = 0.30f)
                    etape == EtapeDisparu.MAGIE -> Palette.Gold.copy(alpha = 0.18f)
                    trou -> Color.Transparent
                    else -> Color.White.copy(alpha = 0.10f)
                },
            )
            .border(if (trou || enOr) 3.dp else 0.dp, if (trou || enOr) Palette.Gold else Color.Transparent, RoundedCornerShape(18.dp)),
        contentAlignment = Alignment.Center,
    ) {
        when {
            etape == EtapeDisparu.MAGIE -> Text("✨", fontSize = 48.sp)
            trou -> Text("?", color = Palette.Gold, fontSize = 64.sp, fontWeight = FontWeight.Black, modifier = Modifier.apparition(0, "trou"))
            else -> BoxWithConstraints(contentAlignment = Alignment.Center) {
                // L'emoji se réduit dans les petites cases (beaucoup d'objets) : le nom reste toujours lisible dessous.
                val taille = with(LocalDensity.current) { ((maxHeight - 34.dp) / 1.15f).coerceIn(16.dp, 52.dp).toSp() }
                // En photos : la photo remplit la case au-dessus du nom (l'émoji reste en secours si elle manque).
                val cote: Dp = min(maxWidth - 12.dp, maxHeight - 40.dp).coerceIn(24.dp, 160.dp)
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = if (enOr) Modifier.apparition(0, "retour") else Modifier) {
                    if (photo != null) {
                        Image(
                            photo, contentDescription = null, contentScale = ContentScale.Crop,
                            modifier = Modifier.size(cote).clip(RoundedCornerShape(12.dp)).border(2.dp, Color.White.copy(alpha = 0.6f), RoundedCornerShape(12.dp)),
                        )
                        Spacer(Modifier.height(4.dp))
                    } else {
                        Text(carte.image ?: "⭐", fontSize = taille, lineHeight = taille * 1.15f)
                    }
                    Text(
                        carte.word,
                        color = if (enOr) Palette.Gold else Palette.Ink, fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.widthIn(max = 160.dp),
                    )
                }
            }
        }
    }
}

/**
 * Photo d'une carte (Qui a disparu ?, Mimes) décodée une fois, réduite pour sa case : [cible] pixels de côté au
 * moins (la Mi Box a peu de mémoire). Null tant qu'elle n'est pas arrivée, ou si elle est abîmée.
 */
@Composable
internal fun photoCarte(octets: ByteArray?, cible: Int): ImageBitmap? = remember(octets, cible) {
    octets?.let {
        runCatching {
            val bornes = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(it, 0, it.size, bornes)
            var reduction = 1
            while (minOf(bornes.outWidth, bornes.outHeight) / (reduction * 2) >= cible) reduction *= 2
            BitmapFactory.decodeByteArray(it, 0, it.size, BitmapFactory.Options().apply { inSampleSize = reduction })?.asImageBitmap()
        }.getOrNull()
    }
}
