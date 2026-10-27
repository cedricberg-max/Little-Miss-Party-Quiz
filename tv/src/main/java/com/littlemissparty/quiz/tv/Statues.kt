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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.engine.STATUES_ANNONCE_MS
import kotlinx.coroutines.delay
import com.littlemissparty.quiz.tv.habillage.Look
import com.littlemissparty.quiz.tv.habillage.Sons
import com.littlemissparty.quiz.tv.habillage.StatuesGameShow
import com.littlemissparty.quiz.tv.habillage.panneauJeu
import com.littlemissparty.quiz.tv.habillage.apparition

/**
 * Statues musicales (cedric, 27/10), étape montrée par la TV : la chanson joue (DANSE), Sarah l'a coupée (STATUE), elle
 * est allée au bout (FINIE), puis, une fois les gagnantes désignées, le roulement de tambour (SUSPENSE), les gagnantes
 * dans leur couleur (GAGNANTES) et le récap des points de la chanson (RECAP). AUTRE : hors du jeu.
 */
enum class EtapeStatues { DANSE, STATUE, FINIE, SUSPENSE, GAGNANTES, RECAP, AUTRE }

/** Roulement de tambour « Et l'équipe gagnante est… » avant les gagnantes ; le récap vient à [STATUES_ANNONCE_MS]. */
const val STATUES_SUSPENSE_MS = 3_500L

/** Étape de l'annonce [at] (heure du serveur) : 1 suspense, 2 gagnantes, 3 récap ; recalculée à chaque palier. */
@Composable
fun annonceStatues(at: Long?, serverOffset: Long): Int {
    fun calcul(): Int {
        if (at == null) return 0
        val t = System.currentTimeMillis() + serverOffset - at
        return if (t < STATUES_SUSPENSE_MS) 1 else if (t < STATUES_ANNONCE_MS) 2 else 3
    }
    var etape by remember(at) { mutableIntStateOf(calcul()) }
    LaunchedEffect(at, serverOffset) {
        while (at != null && etape < 3) {
            val t = System.currentTimeMillis() + serverOffset - at
            delay(((if (t < STATUES_SUSPENSE_MS) STATUES_SUSPENSE_MS else STATUES_ANNONCE_MS) - t).coerceIn(20, 1_000))
            etape = calcul()
        }
    }
    return etape
}

@Composable
fun etapeStatues(state: UiState.Playing): EtapeStatues {
    val st = state.statues.takeIf { state.phase == Phase.QUESTION && state.question?.isStatues == true }
    val annonce = annonceStatues(st?.result?.at, state.serverOffset)
    return when {
        st == null -> EtapeStatues.AUTRE
        st.result != null -> when (annonce) {
            1 -> EtapeStatues.SUSPENSE
            2 -> EtapeStatues.GAGNANTES
            else -> EtapeStatues.RECAP
        }
        st.ended -> EtapeStatues.FINIE
        st.dancing -> EtapeStatues.DANSE
        else -> EtapeStatues.STATUE
    }
}

/** La musique joue-t-elle : chanson en cours, pas de statue ni de pause. */
fun statuesDanse(state: UiState.Playing): Boolean {
    val st = state.statues ?: return false
    return state.phase == Phase.QUESTION && !state.paused && st.dancing && st.enCours
}

/** Musique maison (habillage) : aucune chanson sur la box pour ce tour. */
private const val MAISON = "maison"

/**
 * Musique des statues (cedric, 27/10) : la chanson du tour en cours, jouée ENTIÈRE depuis 0:00 (copiée sur la box), à
 * défaut son extrait, à défaut la musique maison de l'habillage (en boucle). La source est choisie au début du tour et
 * n'en change plus (une chanson entière arrivée en cours de route attend le tour suivant). Coupée net à chaque STATUE !
 * et pendant une pause, elle reprend là où elle était, calée sur l'heure du serveur (box redémarrée comprise). Arrivée
 * au bout : [finie], Sarah choisit les gagnantes. La partie n'attend jamais : un fichier illisible passe au suivant.
 */
@Composable
private fun MusiqueStatues(q: Question, state: UiState.Playing, finie: (Int) -> Unit) {
    val context = LocalContext.current
    val st = state.statues ?: return
    val song = st.song
    val chanson = q.statuesSongs.getOrNull(song)
    // Sources possibles de ce tour, dans l'ordre ; celles qui ont échoué sont écartées.
    val sources = listOfNotNull(chanson?.songId?.let { state.songs[it] }, (chanson?.audioId ?: q.audioId)?.let { state.sounds[it] }, MAISON)
    var choisie by remember(q.id, song) { mutableStateOf<String?>(null) }
    var illisibles by remember(q.id, song) { mutableStateOf(emptySet<String>()) }
    val source = choisie?.takeIf { it !in illisibles } ?: sources.firstOrNull { it !in illisibles } ?: MAISON
    SideEffect { choisie = source }
    val maison = source == MAISON
    val surFin by rememberUpdatedState { finie(song) }
    var essai by remember(source) { mutableIntStateOf(0) }
    val panne: (String) -> Unit = { raison ->
        Sons.incidentChanson("Statues, ${if (maison) "musique maison" else "chanson ${song + 1}"} : $raison${if (essai < ESSAIS_CHANSON) ", lecteur refait" else ""}")
        if (essai < ESSAIS_CHANSON) essai++
    }
    val preparation = rememberPrepareAuCalme(q.id, song, source, essai, liberer = ::rendreLecteur) {
        runCatching {
            MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                if (!maison) setDataSource(source)
                else {
                    // Game Show : sa propre musique des mimes (gs_), pas celle du look Classique.
                    val id = context.resources.getIdentifier(if (Look.gs) "gs_bed_mimes" else "lmp_bed_mimes", "raw", context.packageName)
                        .takeIf { it != 0 } ?: context.resources.getIdentifier("lmp_bed_mimes", "raw", context.packageName)
                    context.resources.openRawResourceFd(id).use { setDataSource(it.fileDescriptor, it.startOffset, it.length) }
                }
                isLooping = maison
                if (!maison) setOnCompletionListener { surFin() }
                prepare()
                setOnErrorListener { _, quoi, extra -> panne("lecteur en erreur ($quoi, $extra)"); true }
            }
        }.onFailure {
            Log.w("Statues", "Musique indisponible", it)
            Sons.incidentChanson("Statues : musique illisible (${it.message})")
        }.getOrNull()
    }
    // Fichier illisible : la source suivante (l'extrait, puis la musique maison).
    LaunchedEffect(source, preparation) {
        if (preparation is Preparation.Faite && preparation.lecteur == null && !maison) illisibles = illisibles + source
    }
    val player = (preparation as? Preparation.Faite)?.lecteur ?: return
    DisposableEffect(player) { onDispose { com.littlemissparty.quiz.tv.habillage.Liberation.lecteur(player, stop = true) } }
    val danse = statuesDanse(state)
    LaunchedEffect(player, danse, st.since) {
        runCatching {
            if (danse) {
                val offset = state.serverOffset
                // Reprise après une pause : la musique repart à la fin du décompte 3, 2, 1.
                val attente = (st.since ?: 0L) - (System.currentTimeMillis() + offset)
                if (attente > 0) delay(attente)
                if (!maison) {
                    val cible = st.positionMs(System.currentTimeMillis() + offset)
                    // Chanson déjà finie (box redémarrée après sa fin) : Sarah choisit les gagnantes.
                    if (player.duration.toLong() in 1..cible) return@runCatching surFin()
                    if (kotlin.math.abs(player.currentPosition - cible) > RECALAGE_MS) player.seekTo(cible.toInt())
                }
                val depart = player.currentPosition
                player.start()
                verifierQueCaJoue(player, depart, panne)
            } else if (player.isPlaying) player.pause()
        }
    }
}

/** Écart toléré entre la chanson jouée et l'heure du serveur avant de la recaler. */
private const val RECALAGE_MS = 1_500L

/**
 * Statues musicales : « DANSEZ ! » qui bouge pendant la musique, « STATUE ! » figé à l'arrêt, fin de la chanson, puis
 * « Et l'équipe gagnante est… », les gagnantes dans leur couleur et le récap des points de la chanson.
 */
@Composable
fun StatuesBoard(q: Question, state: UiState.Playing, actions: TvActions, modifier: Modifier = Modifier) {
    MusiqueStatues(q, state, actions.statuesSongEnded)
    val etape = etapeStatues(state)
    val st = state.statues
    val gagnantes = st?.result?.winners.orEmpty().mapNotNull { uid -> state.teams.find { it.uid == uid } }
    // Game Show : DANSEZ ! qui rebondit, STATUE ! dans la glace, suspense et statue d'or (propositions S1 à S4, 24/10).
    if (Look.gs) { StatuesGameShow(state, etape, gagnantes, modifier); return }
    val anim = rememberInfiniteTransition(label = "danse")
    val balance by anim.animateFloat(-1f, 1f, infiniteRepeatable(tween(450, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "balance")
    BoxWithConstraints(
        modifier.panneauJeu(if (etape == EtapeStatues.STATUE) 0.18f else 0.08f),
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
            when (etape) {
                EtapeStatues.DANSE -> {
                    Text(
                        "DANSEZ !", color = Palette.Gold, fontSize = t(130), lineHeight = t(136), fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                        modifier = Modifier.graphicsLayer { rotationZ = 4f * balance; translationY = -10f * balance },
                    )
                    Text("Bougez tant que la musique joue !", color = Palette.Ink, fontSize = t(32), lineHeight = t(40), fontWeight = FontWeight.Bold, maxLines = 1)
                }
                EtapeStatues.STATUE -> {
                    Text(
                        "STATUE !", color = Palette.Ink, fontSize = t(140), lineHeight = t(146), fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
                        modifier = Modifier.apparition(0, "statue"),
                    )
                    Text("Plus personne ne bouge…", color = Palette.Gold, fontSize = t(34), lineHeight = t(42), fontWeight = FontWeight.Black, maxLines = 1)
                }
                EtapeStatues.FINIE -> {
                    Text("Fin de la chanson !", color = Palette.Gold, fontSize = t(64), lineHeight = t(72), fontWeight = FontWeight.Black, maxLines = 1)
                    Spacer(Modifier.height(12.dp * f))
                    Text("Plus personne ne bouge…", color = Palette.Ink, fontSize = t(30), lineHeight = t(38), fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                }
                EtapeStatues.SUSPENSE -> Text(
                    "Et l'équipe gagnante est…", color = Palette.Gold, fontSize = t(64), lineHeight = t(72), fontWeight = FontWeight.Black,
                    textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 24.dp).apparition(0, "suspense"),
                )
                EtapeStatues.GAGNANTES -> if (gagnantes.isEmpty()) {
                    Text("Personne cette fois !", color = Palette.Gold, fontSize = t(64), lineHeight = t(72), fontWeight = FontWeight.Black, maxLines = 1, modifier = Modifier.apparition(0, "personne"))
                    Spacer(Modifier.height(12.dp * f))
                    Text("On se rattrape à la prochaine chanson !", color = Palette.Ink, fontSize = t(30), lineHeight = t(38), fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                } else {
                    Text("Bravo", color = Palette.Ink, fontSize = t(34), lineHeight = t(42), fontWeight = FontWeight.Black, maxLines = 1)
                    gagnantes.forEachIndexed { i, team ->
                        Text(
                            team.name, color = team.color.toColor(), fontSize = t(if (gagnantes.size > 2) 44 else 60), lineHeight = t(if (gagnantes.size > 2) 50 else 66),
                            fontWeight = FontWeight.Black, maxLines = 1, textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 24.dp).apparition(150L * i, team.uid),
                        )
                    }
                }
                EtapeStatues.RECAP -> RecapStatues(state, f)
                EtapeStatues.AUTRE -> {}
            }
        }
    }
}

/** Récap d'une chanson : chaque équipe, ses points de la chanson et son total ; les gagnantes d'abord. */
@Composable
private fun RecapStatues(state: UiState.Playing, f: Float) {
    val r = state.statues?.result ?: return
    val tours = state.question?.statuesTours ?: 1
    Text(
        if (tours > 1) "Chanson ${r.song + 1} / $tours" else "Les points de la chanson",
        color = Palette.Gold, fontSize = (34 * f).sp, lineHeight = (40 * f).sp, fontWeight = FontWeight.Black, maxLines = 1,
    )
    Spacer(Modifier.height(8.dp * f))
    val lignes = state.teams.sortedWith(compareByDescending<Team> { r.gains[it.uid] ?: 0 }.thenByDescending { state.scores[it.uid] ?: 0 })
    // Jusqu'à 8 équipes : deux colonnes au-delà de 4, pour que rien ne soit coupé.
    val colonnes = if (lignes.size > 4) 2 else 1
    val taille = (if (lignes.size > 4) 22 else 28) * f
    androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(40.dp * f)) {
        lignes.chunked((lignes.size + colonnes - 1) / colonnes).forEach { colonne ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp * f)) {
                colonne.forEachIndexed { i, team ->
                    val gain = r.gains[team.uid] ?: 0
                    androidx.compose.foundation.layout.Row(Modifier.apparition(80L * i, team.uid), verticalAlignment = Alignment.CenterVertically) {
                        Text(team.name, color = team.color.toColor(), fontSize = taille.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false)
                        Spacer(Modifier.width(14.dp * f))
                        Text(if (gain > 0) "+$gain" else "0", color = if (gain > 0) Palette.Gold else Palette.Ink, fontSize = taille.sp, fontWeight = FontWeight.Black, maxLines = 1)
                        Spacer(Modifier.width(10.dp * f))
                        Text("(${state.scores[team.uid] ?: 0})", color = Palette.Ink, fontSize = (taille * 0.8f).sp, fontWeight = FontWeight.Bold, maxLines = 1)
                    }
                }
            }
        }
    }
}
