package com.littlemissparty.quiz.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.BlindStatus
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.tv.habillage.BlindBilan
import com.littlemissparty.quiz.tv.habillage.panneauJeu
import com.littlemissparty.quiz.tv.habillage.TexteJauge
import com.littlemissparty.quiz.tv.habillage.BlindBuzz
import com.littlemissparty.quiz.tv.habillage.BlindDouble
import com.littlemissparty.quiz.tv.habillage.BlindIntro
import com.littlemissparty.quiz.tv.habillage.BlindRevelation
import com.littlemissparty.quiz.tv.habillage.BlindTestBoard
import com.littlemissparty.quiz.tv.habillage.Echelle
import com.littlemissparty.quiz.tv.habillage.EchelleSansCoupe
import com.littlemissparty.quiz.tv.habillage.Look
import com.littlemissparty.quiz.tv.habillage.apparition
import com.littlemissparty.quiz.tv.habillage.apres
import com.littlemissparty.quiz.tv.habillage.rebond

/** Pochette du morceau (photo choisie dans l'admin), une fois chargée sur la box ; null sinon. */
@Composable
fun pochette(q: Question, state: UiState.Playing): ImageBitmap? {
    val bytes = q.imageId?.let { state.images[it] }
    return rememberPhoto(bytes)
}

/** Nom de la playlist sans le « Blind test · » du titre de manche, déjà écrit en grand sur la présentation. */
private fun nomPlaylist(titre: String) = titre.replace(Regex("^\\s*blind\\s*test\\s*[·:\\-–—]?\\s*", RegexOption.IGNORE_CASE), "")

/**
 * Blind test, tout l'espace au-dessus des équipes et des boutons : la présentation (premier morceau en attente),
 * l'écoute (platine et panneau), « STOP ! » au buzz, puis la révélation avec la pochette. Chaque scène se met à
 * l'échelle de la place, de 1 à 8 équipes.
 */
@Composable
fun BlindScene(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val b = state.blind
    val buzzer = state.teams.find { it.uid == state.buzzTeam }
    when {
        state.phase == Phase.REVEAL || state.phase == Phase.SCORES -> {
            val gagnant = state.teams.find { (state.awards[it.uid]?.points ?: 0) > 0 }
            BlindRevelation(
                cle = q.id,
                pochette = pochette(q, state),
                titre = q.choices.getOrNull(q.correct).orEmpty(),
                artiste = q.artist,
                gagnant = gagnant?.let { it.name to it.color.toColor() },
                points = gagnant?.let { state.awards[it.uid]?.points } ?: 0,
                double = b?.doubled == true,
                modifier = modifier,
                // Refrain préparé et prêt sur la box : il joue en boucle pendant toute la révélation.
                chantons = state.phase == Phase.REVEAL && q.refrainId?.let { it in state.sounds } == true,
                // Ses paroles (fichier .lrc de la Régie PC), au rythme du refrain qu'on entend.
                paroles = q.paroles,
                positionMs = PositionRefrain::ms,
            )
        }
        state.phase == Phase.QUESTION && buzzer != null -> BlindBuzz(buzzer.name, buzzer.color.toColor(), modifier)
        state.phase == Phase.QUESTION && b != null && b.numero == 1 && b.waiting && !b.played ->
            BlindIntro(nomPlaylist(b.playlist), b.total, b.points, modifier)
        else -> {
            val ecoute: @Composable BoxScope.() -> Unit = {
                Row(Modifier.fillMaxSize()) {
                    val joue = state.phase == Phase.QUESTION && state.deadline != null && !state.paused && b?.waiting != true
                    val manquant = q.audioId == null || state.sounds[q.audioId] == null
                    BlindTestBoard(joue, manquant, Modifier.weight(1.1f).fillMaxHeight())
                    Spacer(Modifier.width(20.dp))
                    BlindPanel(q, state, Modifier.weight(1f).fillMaxHeight())
                }
            }
            // Game Show : les lasers de la platine néon montent au-dessus de la scène, rien ne les coupe.
            if (Look.gs) EchelleSansCoupe(880.dp, 400.dp, modifier, ecoute) else Echelle(880.dp, 400.dp, modifier, contenu = ecoute)
        }
    }
}

/**
 * Quiz musical, révélation (cedric, 24/10) : celle du blind test en plus court, après la bonne réponse allumée sur les
 * cartes. Pochette, titre et artiste ; avec un refrain préparé, ses paroles au rythme des quelques secondes de musique.
 * Toutes les équipes qui ont trouvé sont félicitées, chacune dans sa couleur ; leurs points restent sous la scène.
 */
@Composable
fun RevelationMusicale(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    BlindRevelation(
        cle = q.id,
        pochette = pochette(q, state),
        titre = q.choices.getOrNull(q.correct).orEmpty(),
        artiste = q.artist,
        gagnant = null,
        points = 0,
        double = false,
        modifier = modifier,
        chantons = q.refrainId?.let { it in state.sounds } == true,
        paroles = q.paroles,
        positionMs = PositionRefrain::ms,
        gagnants = state.teams.filter { (state.awards[it.uid]?.points ?: 0) > 0 }.map { it.name to it.color.toColor() },
    )
}

/**
 * Premier des morceaux à double valeur, encore en attente : « × 2 » par-dessus tout l'écran pendant l'annonce
 * sonore (lmp_bt_double), puis l'écran du morceau revient avec « POINTS DOUBLÉS ».
 */
@Composable
fun BlindAnnonceDouble(q: Question, state: UiState.Playing) {
    val b = state.blind ?: return
    val precedent = b.tracks.getOrNull(b.numero - 2)
    val annonce = q.isBlind && state.phase == Phase.QUESTION && b.doubled && b.waiting && !b.played && state.buzzTeam == null &&
        precedent != null && precedent.points != b.points
    val fini = apres(4_500, q.id, actif = annonce)
    if (annonce && !fini) BlindDouble(b.points, b.doubledLeft)
}

/** Bilan du blind test : les points gagnés par chaque équipe pendant le blind test (morceaux trouvés). */
@Composable
fun BlindBilanEcran(state: UiState.Playing, modifier: Modifier = Modifier) {
    val b = state.blind ?: return
    val lignes = state.teams.map { t ->
        Triple(t.name, t.color.toColor(), b.tracks.filter { it.status == BlindStatus.FOUND && it.team == t.uid }.sumOf { it.points })
    }
    BlindBilan(lignes, modifier)
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
        modifier.panneauJeu(0.08f).padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Game Show : textes d'information posés sur le décor « comme les jauges » (choix B du 31/10, n° 1), sans le carré du
        // 30/10. Les appels et conseils (n° 2) deviendront des onglets néon (cedric, 31/10 09:19).
        Column(verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            // À la révélation, le panneau garde sa hauteur pour le titre et le gagnant (960 × 540 dp sur la box) :
            // la valeur du morceau est dans le « +N ».
            if (b != null && !revele) {
                TexteJauge("Morceau ${b.numero} / ${b.total}", color = Palette.InkSoft, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                // Points doublés : la pastille dorée reste telle quelle, sans contour.
                TexteJauge(
                    if (b.doubled) "POINTS DOUBLÉS · ${b.points} points" else "${b.points} points",
                    color = if (b.doubled) Palette.Night else Palette.Gold, fontSize = 22.sp, fontWeight = FontWeight.Black,
                    modifier = Modifier.padding(top = 6.dp).clip(RoundedCornerShape(50))
                        .background(if (b.doubled) Palette.Gold else Color.Transparent).padding(horizontal = 14.dp, vertical = 4.dp)
                        .apparition(0, b.numero),
                    contour = !b.doubled,
                )
                Spacer(Modifier.height(18.dp))
            }
            when {
                revele -> {
                    TexteJauge("C'était…", color = Palette.InkSoft, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    TexteJauge(
                        q.choices.getOrNull(q.correct).orEmpty(),
                        color = Palette.Gold, fontSize = 34.sp, lineHeight = 38.sp, fontWeight = FontWeight.Black,
                        textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.apparition(300, q.id),
                    )
                    q.artist?.takeIf { it.isNotBlank() }?.let {
                        TexteJauge(
                            it, color = Palette.Ink, fontSize = 24.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
                            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.apparition(700, q.id),
                        )
                    }
                    Spacer(Modifier.height(10.dp))
                    if (gagnant != null) {
                        TexteJauge(
                            "Bonne réponse ! Bravo ${gagnant.name}",
                            color = gagnant.color.toColor(), fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.Black,
                            textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.apparition(1100, q.id),
                        )
                        TexteJauge(
                            "+${state.awards[gagnant.uid]?.points ?: 0}",
                            color = Palette.Gold, fontSize = 40.sp, fontWeight = FontWeight.Black,
                            modifier = Modifier.apparition(1400, q.id).rebond(true, 0.12f),
                        )
                    } else {
                        TexteJauge(
                            "Personne n'a trouvé, ce n'est pas grave !", color = Palette.Ink, fontSize = 22.sp, lineHeight = 28.sp,
                            fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.apparition(1100, q.id),
                        )
                    }
                }
                buzzer != null -> {
                    TexteJauge(
                        "${buzzer.name} a buzzé !",
                        color = buzzer.color.toColor(), fontSize = 46.sp, lineHeight = 52.sp, fontWeight = FontWeight.Black,
                        textAlign = TextAlign.Center, modifier = Modifier.apparition(0, buzzer.uid),
                    )
                    Spacer(Modifier.height(14.dp))
                    TexteJauge("On attend sa réponse…", color = Palette.Ink, fontSize = 30.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                }
                // Appels et conseils (n° 2, cedric 09:19) : futurs onglets néon, texte simple en attendant.
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
                TexteJauge(
                    "Déjà essayé : " + passees.joinToString(", ") { it.name },
                    color = Palette.InkSoft, fontSize = 22.sp, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
