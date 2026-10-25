package com.littlemissparty.quiz.tv

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Log
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.tv.habillage.Look
import com.littlemissparty.quiz.tv.habillage.Sons
import com.littlemissparty.quiz.tv.habillage.StatuesGameShow
import com.littlemissparty.quiz.tv.habillage.panneauJeu
import com.littlemissparty.quiz.tv.habillage.apparition

/** Statues musicales : la musique joue-t-elle à cet instant (question en cours, chrono qui tourne, pas une statue) ? */
@Composable
fun statuesDanse(q: Question, state: UiState.Playing): Boolean {
    val remaining = chronoRestant(q, state)
    val tourne = state.phase == Phase.QUESTION && state.deadline != null && !state.paused && remaining > 0
    return tourne && !q.statueAt(q.durationMs - remaining)
}

/**
 * Musique des statues : les chansons choisies par Sarah ([Question.audioIds], déposées dans l'administration et
 * copiées sur la box), jouées l'une après l'autre puis de nouveau la première ; sans chanson, une boucle de
 * l'habillage (musique maison, sans droits). Elle est coupée net à chaque statue et pendant une pause, puis reprend
 * là où elle s'était arrêtée. Une chanson pas encore arrivée ou illisible est sautée ; si aucune n'est là, la musique
 * maison joue : la partie n'attend jamais, et la TV affiche quand même « DANSEZ ! » et « STATUE ! ».
 */
@Composable
private fun MusiqueStatues(danse: Boolean, chansons: List<String>) {
    val context = LocalContext.current
    var rang by remember(chansons) { mutableIntStateOf(0) }
    var illisibles by remember(chansons) { mutableStateOf(emptySet<String>()) }
    val jouables = chansons.filter { it !in illisibles }
    val chanson = if (jouables.isEmpty()) null else jouables[rang % jouables.size]
    // Lecteur en panne (erreur, ou muet pendant la danse : TV du 25/10 au soir) : refait, deux fois au plus.
    var essai by remember(chanson) { mutableIntStateOf(0) }
    val panne: (String) -> Unit = { raison ->
        Sons.incidentChanson("Statues, ${if (chanson == null) "musique maison" else "chanson"} : $raison${if (essai < ESSAIS_CHANSON) ", lecteur refait" else ""}")
        if (essai < ESSAIS_CHANSON) essai++
    }
    val player = remember(chanson, jouables.size, essai) {
        runCatching {
            MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                if (chanson != null) setDataSource(chanson)
                else {
                    // Game Show : sa propre musique des mimes (gs_), pas celle du look Classique.
                    val id = context.resources.getIdentifier(if (Look.gs) "gs_bed_mimes" else "lmp_bed_mimes", "raw", context.packageName)
                        .takeIf { it != 0 } ?: context.resources.getIdentifier("lmp_bed_mimes", "raw", context.packageName)
                    context.resources.openRawResourceFd(id).use { setDataSource(it.fileDescriptor, it.startOffset, it.length) }
                }
                // Une seule chanson (ou la musique maison) : en boucle ; plusieurs : la suivante à la fin de chacune.
                isLooping = jouables.size <= 1
                if (jouables.size > 1) setOnCompletionListener { rang++ }
                prepare()
                setOnErrorListener { _, quoi, extra -> panne("lecteur en erreur ($quoi, $extra)"); true }
            }
        }.onFailure {
            Log.w("Statues", "Musique indisponible", it)
            Sons.incidentChanson("Statues : musique illisible (${it.message})")
        }.getOrNull()
    }
    // Chanson illisible : écartée, la suivante joue ; plus aucune : la musique maison prend le relais.
    LaunchedEffect(chanson, player) { if (player == null && chanson != null) illisibles = illisibles + chanson }
    if (player == null) return
    DisposableEffect(player) { onDispose { runCatching { player.stop() }; runCatching { player.release() } } }
    LaunchedEffect(player, danse) {
        runCatching {
            if (danse) {
                val depart = player.currentPosition
                player.start()
                verifierQueCaJoue(player, depart, panne)
            } else if (player.isPlaying) player.pause()
        }
    }
}

/** Statues musicales : « DANSEZ ! » qui bouge pendant la musique, « STATUE ! » figé à l'arrêt. */
@Composable
fun StatuesBoard(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val danse = statuesDanse(q, state)
    // Seules les chansons déjà copiées sur la box ; aucune : la musique maison joue, la partie n'attend jamais.
    MusiqueStatues(danse, q.audioIds.ifEmpty { listOfNotNull(q.audioId) }.mapNotNull { state.sounds[it] })
    // Game Show : DANSEZ ! qui rebondit, STATUE ! dans la glace, suspense et statue d'or (propositions S1 à S4, 24/10).
    if (Look.gs) { StatuesGameShow(state, danse, modifier); return }
    val enCours = state.phase == Phase.QUESTION
    val anim = rememberInfiniteTransition(label = "danse")
    val balance by anim.animateFloat(-1f, 1f, infiniteRepeatable(tween(450, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "balance")
    BoxWithConstraints(
        modifier.panneauJeu(if (enCours && !danse) 0.18f else 0.08f),
        contentAlignment = Alignment.Center,
    ) {
        // Le panneau rétrécit avec le bandeau des équipes (jusqu'à 8) : les textes rapetissent pour tenir sous
        // l'étiquette, jamais coupés en bas (vu sur le banc d'essai le 20 octobre).
        val f = ((maxHeight - 52.dp) / 200.dp).coerceIn(0.45f, 1f)
        fun t(v: Int) = (v * f).sp
        Text(
            "STATUES MUSICALES",
            color = Palette.Night, fontSize = 18.sp, fontWeight = FontWeight.Black,
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 12.dp)
                .clip(RoundedCornerShape(50)).background(Palette.Gold).padding(horizontal = 14.dp, vertical = 4.dp),
        )
        Column(Modifier.padding(top = 44.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            when {
                enCours && danse -> {
                    Text(
                        "DANSEZ !", color = Palette.Gold, fontSize = t(130), lineHeight = t(136), fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                        modifier = Modifier.graphicsLayer { rotationZ = 4f * balance; translationY = -10f * balance },
                    )
                    Text("Bougez tant que la musique joue !", color = Palette.Ink, fontSize = t(32), lineHeight = t(40), fontWeight = FontWeight.Bold, maxLines = 1)
                }
                enCours -> {
                    Text(
                        "STATUE !", color = Palette.Ink, fontSize = t(140), lineHeight = t(146), fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                        modifier = Modifier.apparition(0, "statue"),
                    )
                    Text("Plus personne ne bouge…", color = Palette.Gold, fontSize = t(34), lineHeight = t(42), fontWeight = FontWeight.Black, maxLines = 1)
                }
                state.phase == Phase.CLOSED -> {
                    Text("Fin de la musique !", color = Palette.Gold, fontSize = t(64), lineHeight = t(72), fontWeight = FontWeight.Black, maxLines = 1)
                    Spacer(Modifier.height(12.dp * f))
                    Text("L'animatrice désigne l'équipe gagnante.", color = Palette.Ink, fontSize = t(30), lineHeight = t(38), fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                }
                else -> {
                    val gagnant = state.teams.find { state.awards[it.uid]?.correct == true }
                    Text(
                        gagnant?.let { "Bravo ${it.name} !" } ?: "Bravo à tous les danseurs !",
                        color = gagnant?.color?.toColor() ?: Palette.Gold, fontSize = t(60), lineHeight = t(66), fontWeight = FontWeight.Black,
                        textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 24.dp).apparition(0, gagnant?.uid),
                    )
                    Spacer(Modifier.height(12.dp * f))
                    Text("Les meilleures statues de la fête !", color = Palette.Ink, fontSize = t(30), lineHeight = t(38), fontWeight = FontWeight.Bold, maxLines = 1)
                }
            }
        }
    }
}
