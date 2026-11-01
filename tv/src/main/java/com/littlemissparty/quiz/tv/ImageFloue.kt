package com.littlemissparty.quiz.tv

import android.graphics.Bitmap
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Animatable
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
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.tv.habillage.GenrePlaque
import com.littlemissparty.quiz.tv.habillage.TeteBuzzyMemorise
import com.littlemissparty.quiz.tv.habillage.PlaqueAppel
import com.littlemissparty.quiz.tv.habillage.GS
import com.littlemissparty.quiz.tv.habillage.AppelBuzzQuiSuis
import com.littlemissparty.quiz.tv.habillage.Look
import com.littlemissparty.quiz.tv.habillage.TexteJauge
import com.littlemissparty.quiz.tv.habillage.RevelationNeon
import com.littlemissparty.quiz.tv.habillage.revelationAvecMot
import com.littlemissparty.quiz.tv.habillage.apparition
import com.littlemissparty.quiz.tv.habillage.panneauJeu
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * Largeurs successives de la photo, de la plus floue à la plus nette. Le flou vient de l'agrandissement
 * lissé d'une toute petite image : il marche sur toutes les box, même en Android 9 où le flou de Compose
 * n'existe pas, et ne coûte presque rien.
 */
private val NIVEAUX = listOf(5, 8, 12, 18, 26, 38, 56, 80, 120, 170)

/**
 * Les largeurs de cette question : réglée plus floue dans la Régie PC (flouDepart 2, 3 ou 4 pixels), la photo part
 * de là puis rejoint les niveaux d'aujourd'hui, dans le même temps de chrono (cedric, 1/11 : « ça se dévoile un peu
 * plus vite, le temps ne change pas »).
 */
internal fun niveauxDe(q: Question): List<Int> =
    (q.flouDepart?.takeIf { it in 2..4 }?.let { (it..4).toList() } ?: emptyList()) + NIVEAUX

/**
 * Les deux niveaux de la pile (flous de [NIVEAUX], puis la photo nette) fondus l'un dans l'autre pour [niveau]. Avant la
 * révélation, jamais la photo nette : le niveau le plus net reste une petite image agrandie.
 */
internal fun niveauxAffiches(niveau: Float, revealed: Boolean, flous: Int = NIVEAUX.size): Pair<Int, Int> {
    val max = if (revealed) flous else flous - 1
    val bas = niveau.toInt().coerceIn(0, max)
    return bas to (bas + 1).coerceAtMost(max)
}

/** Nombre de niveaux flous avant la photo nette. */
internal val NIVEAUX_FLOUS: Int get() = NIVEAUX.size

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

/** Les photos de plus en plus nettes de l'Image floue ([NIVEAUX] pixels de large), calculées hors de l'écran. */
private fun niveauxDeFlou(p: Bitmap, largeurs: List<Int>): List<ImageBitmap> = largeurs.map { w ->
    val largeur = w.coerceAtMost(p.width)
    val hauteur = (p.height * largeur / p.width.toFloat()).toInt().coerceAtLeast(1)
    Bitmap.createScaledBitmap(p, largeur, hauteur, true).asImageBitmap()
}

/**
 * Image floue : la photo devient de plus en plus nette au fil du chrono ; elle se fige quand une équipe
 * buzze (le chrono attend le verdict de l'animatrice) et apparaît enfin nette à la révélation.
 */
@Composable
fun FlouPhoto(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val bytes = q.imageId?.let { state.images[it] }
    // Photo et niveaux de flou préparés en fond (test du 27/10 au soir : petits blocages au début des questions) ;
    // la photo nette, décodée d'avance par la box, sert de base.
    val nette = rememberPhoto(bytes)
    val largeurs = remember(q.id, q.flouDepart) { niveauxDe(q) }
    val pile by produceState<Pair<ImageBitmap?, List<ImageBitmap>>>(null to emptyList(), nette, largeurs) {
        val p = nette ?: return@produceState
        value = p to withContext(Photos.fil) { niveauxDeFlou(p.asAndroidBitmap(), largeurs) }
    }
    val niveaux = pile.second.takeIf { pile.first === nette && nette != null && it.size == largeurs.size }.orEmpty()
    val total = q.durationMs.coerceAtLeast(1)
    val remaining = chronoRestant(q, state)
    val revealed = state.phase == Phase.REVEAL || state.phase == Phase.SCORES
    val progress = (1f - remaining.toFloat() / total).coerceIn(0f, 1f)
    // Lent au début, plus rapide vers la fin : l'image reste mystérieuse un bon moment.
    val flous = largeurs.size
    val cible = if (revealed) flous.toFloat() else (flous - 1) * progress * progress
    // Une animation par question : partie de la photo nette de la révélation d'avant, elle repassait une fraction de
    // seconde par les niveaux nets sur la nouvelle photo (test du 27/10 au soir : « on l'a vue une fraction de seconde »).
    val anim = remember(q.id) { Animatable(cible) }
    LaunchedEffect(q.id, cible, revealed) {
        anim.animateTo(cible, if (revealed) tween(1_200, easing = FastOutSlowInEasing) else tween(120, easing = LinearEasing))
    }
    val niveau = anim.value
    Box(
        modifier.clip(RoundedCornerShape(28.dp)).background(Color.White.copy(alpha = 0.12f)),
        contentAlignment = Alignment.Center,
    ) {
        if (nette != null && niveaux.isNotEmpty()) {
            // Fondu entre deux niveaux voisins : la photo se précise en douceur, sans à-coups.
            val pile = niveaux + nette
            val (bas, haut) = niveauxAffiches(niveau, revealed, flous)
            val t = (niveau - bas).coerceIn(0f, 1f)
            Image(
                pile[bas], contentDescription = "Image floue", contentScale = ContentScale.Crop, alignment = CadrageHaut,
                filterQuality = FilterQuality.Low, modifier = Modifier.fillMaxSize(),
            )
            if (haut != bas && t > 0.01f) {
                Image(
                    pile[haut], contentDescription = null, contentScale = ContentScale.Crop, alignment = CadrageHaut,
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

/**
 * Sous « X a buzzé ! » : ce qui se passe maintenant, en mots simples (cedric, 30/10 : « Votre réponse, à voix haute ! »
 * ne se comprenait pas). L'équipe parle, l'animatrice écoute puis décide.
 */
internal fun consigneBuzz(chante: Boolean, blind: Boolean) = when {
    chante -> "À vous de chanter !"
    blind -> "On écoute le titre…"
    else -> "On écoute sa réponse…"
}

/** Game Show : l'onglet « BUZZEZ ! » de chaque jeu au buzzer et sa petite ligne (planche du 31/10, validée à 11:12). */
internal fun appelGs(q: Question): Pair<GenrePlaque, String> = when {
    q.isDisparu -> GenrePlaque.DISPARU to "dès que vous savez\nquel objet a disparu"
    q.isChante -> GenrePlaque.CHANTE to "et chantez une chanson\navec ce mot"
    q.isQuiSuis -> GenrePlaque.QUISUIS to "dès que vous savez\nqui je suis"
    q.isBlind -> GenrePlaque.BLIND to "dès que vous reconnaissez\nla chanson"
    else -> GenrePlaque.FLOUE to "dès que vous reconnaissez l'image"
}

/** Panneau des jeux au buzzer (image floue, chante le mot, qui suis-je) : consigne, équipe qui a buzzé, équipes déjà passées, puis la réponse. */
@Composable
fun FlouPanel(q: Question, state: UiState.Playing, modifier: Modifier = Modifier) {
    val buzzer = state.teams.find { it.uid == state.buzzTeam }
    val passees = state.teams.filter { it.uid in state.buzzBlocked }
    val gagnant = state.teams.find { (state.awards[it.uid]?.points ?: 0) > 0 }
    // Qui suis-je ? du Game Show : marge réduite, « BUZZEZ ! » et les équipes déjà essayées tiennent même à 4 équipes,
    // où les pastilles hautes laissent peu de hauteur au panneau (test du 30/10 au soir).
    val appelQuiSuis = Look.gs && q.isQuiSuis && state.phase == Phase.QUESTION && buzzer == null
    // Révélation du Qui suis-je ? (Game Show) : même petite marge, la phrase garde sa place à 4 équipes (CI du 31/10).
    val revelationQuiSuis = Look.gs && q.isQuiSuis && (state.phase == Phase.REVEAL || state.phase == Phase.SCORES)
    val margeReduite = appelQuiSuis || revelationQuiSuis
    Column(
        modifier.panneauJeu(0.08f).padding(if (margeReduite) 12.dp else 28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Game Show : plus de filigrane derrière. Le nom de l'équipe qui a buzzé et « Déjà essayé » ont le contour « comme les
        // jauges » ; les appels et conseils (n° 4-8) deviendront des onglets néon (cedric, 31/10 09:19), texte simple en attendant.
        Column(
            Modifier,
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
                    avecMot = revelationAvecMot(q.isChante),
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
                    // De 1 à 8 équipes, tout tient dans le panneau : le nom sur une ligne tant qu'il reste grand, la
                    // consigne entière dessous (test du 30/10 : « Votre réponse, à voix… » rogné sous les équipes).
                    TexteAjuste(
                        "${buzzer.name} a buzzé !", color = buzzer.color.toColor(), max = 46.sp, min = 20.sp, lignes = 2, uneLigneJusqua = 30.sp,
                        jauge = true, modifier = Modifier.fillMaxWidth().weight(1f, fill = false).apparition(0, buzzer.uid),
                    )
                    Spacer(Modifier.height(14.dp))
                    TexteAjuste(
                        consigneBuzz(q.isChante, q.isBlind), color = Palette.Ink, max = 30.sp, min = 16.sp, lignes = 2, uneLigneJusqua = 22.sp,
                        fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth(),
                    )
                }
                state.phase == Phase.CLOSED -> Text(
                    if (q.isFlou) "Temps écoulé ! Voyons ce qui se cachait…" else if (q.isBlind) "Temps écoulé ! Écoutons la réponse…" else "Temps écoulé !",
                    color = Palette.Gold, fontSize = 32.sp, lineHeight = 38.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                )
                // Qui suis-je ? du Game Show (planche du 28/10) : « BUZZEZ ! » en néon, sans buzzer dessiné, et les essais ratés.
                appelQuiSuis -> AppelBuzzQuiSuis(passees.map { it.name })
                // Game Show : les onglets d'appel néon validés par cedric le 31/10 à 11:12 (planche des onglets d'appel).
                Look.gs && q.isDisparu && etapeDisparu(q, state) != EtapeDisparu.CHERCHER -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    // Choix A de cedric (planche du 1/11, point 36) : la petite tête de Buzzy à la place de l'œil, et
                    // « Regardez bien ! » (choix de cedric sur le tableau du 1/11), sans parler d'objets (les cartes n'en sont pas toujours).
                    TeteBuzzyMemorise()
                    Spacer(Modifier.height(10.dp))
                    PlaqueAppel(GenrePlaque.DISPARU, "REGARDEZ BIEN !", "")
                }
                Look.gs -> appelGs(q).let { (genre, ligne) -> PlaqueAppel(genre, "BUZZEZ !", ligne) }
                q.isDisparu && etapeDisparu(q, state) != EtapeDisparu.CHERCHER -> Text(
                    "Regardez bien !",
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
            if (passees.isNotEmpty() && state.phase == Phase.QUESTION && !(Look.gs && q.isQuiSuis && buzzer == null)) {
                Spacer(Modifier.height(24.dp))
                TexteJauge(
                    "Déjà essayé : " + passees.joinToString(", ") { it.name },
                    color = Palette.InkSoft, fontSize = 22.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                    // Jusqu'à 7 équipes déjà passées : deux lignes au plus, la fin s'efface en « … ».
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
