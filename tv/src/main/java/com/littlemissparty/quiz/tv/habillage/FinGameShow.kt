package com.littlemissparty.quiz.tv.habillage

import android.os.SystemClock
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.littlemissparty.quiz.tv.R
import kotlinx.coroutines.delay
import kotlin.math.abs

/** La vidéo de fin : 8 s d'arrivée, puis une boucle parfaite de 16 s ([FIN_BOUCLE_DEBUT_MS] → la fin du fichier). */
internal const val FIN_BOUCLE_DEBUT_MS = 8_000
internal const val FIN_BOUCLE_MS = 16_000
/** Un temps d'Aerodynamic (120 BPM) : la vidéo bat sur les temps de la musique. */
internal const val FIN_TEMPS_MS = 500
private const val FONDU_FIN_MS = 500
/** Les messages arrivent comme dans l'aperçu validé : « Merci » à 5 s, « À bientôt » à 6 s, en 1,2 s chacun. */
private const val MERCI_MS = 5_000
private const val A_BIENTOT_MS = 6_000
private const val APPARITION_TEXTE_MS = 1_200

/**
 * Écran de fin cinéma du Game Show (choix de cedric du 24 octobre), après le podium, sur le dernier groove
 * d'Aerodynamic : la vidéo res/raw/gs_fin_video.mp4, calculée à l'avance en 3D sur le plateau (gros plan du robot qui
 * fait un clin d'œil, la caméra recule, le logo s'allume avec « by Little Miss Party »), puis le robot qui dit au revoir
 * dans l'arche, en boucle aussi longtemps qu'il faut. La vidéo part sur un temps de la musique et sa boucle reste calée
 * sur les tours de gs_bed_fin ([Sons.tourFin]). L'appli écrit en direct « Merci d'avoir participé ! » et « À bientôt
 * sur The Game Show ! » dans le bas, resté calme dans la vidéo. Une seule vidéo à la fois : pendant ce temps le décor
 * du dessous ne lit pas son fond ([Habillage.finVideo]) et aucun clip du robot ne passe. Si la vidéo ne se lit pas,
 * l'écran de fin dessiné d'avant revient ([AuRevoirGameShow]). Rien ici ne touche à la partie.
 */
@Composable
fun FinCinemaGameShow(modifier: Modifier = Modifier) {
    var echec by remember { mutableStateOf(false) }
    if (echec) return AuRevoirGameShow(modifier)
    DisposableEffect(Unit) {
        Habillage.finVideo.value = true
        onDispose { Habillage.finVideo.value = false }
    }
    var prete by remember { mutableStateOf(false) }
    var lecteur by remember { mutableStateOf<LecteurFond?>(null) }
    val opacite = remember { Animatable(0f) }
    LaunchedEffect(prete) { if (prete) opacite.animateTo(1f, tween(FONDU_FIN_MS)) }
    Box(modifier.fillMaxSize()) {
        AndroidView(
            factory = {
                LecteurFond(
                    it, R.raw.gs_fin_video, surPret = { prete = true }, surEchec = { echec = true }, boucle = false,
                    repriseMs = FIN_BOUCLE_DEBUT_MS, attenteMs = { attenteFin(SystemClock.elapsedRealtime(), Sons.tourFin) },
                )
            },
            update = {
                lecteur = it
                it.alpha = opacite.value
            },
            onRelease = { it.liberer() },
            modifier = Modifier.fillMaxSize(),
        )
        if (prete) MessagesFin()
    }
    // La boucle de la vidéo suit les tours de la musique, en accélérant ou ralentissant un peu ([SuiviMusique]).
    LaunchedEffect(lecteur) {
        val v = lecteur ?: return@LaunchedEffect
        var ancre = 0L
        val suivi = SuiviMusique()
        while (true) {
            delay(200)
            val pos = v.position() ?: continue
            val maintenant = SystemClock.elapsedRealtime()
            // Instant où la boucle de 16 s commence (ou commencera, pendant l'arrivée), d'après la vidéo elle-même,
            // puis posé sur les temps de la musique dès qu'elle joue.
            if (ancre == 0L) ancre = maintenant - (pos - FIN_BOUCLE_DEBUT_MS)
            ancre = ancreSurMusique(ancre, Sons.tourFin)
            if (pos < FIN_BOUCLE_DEBUT_MS || maintenant < ancre) continue
            val attendu = positionFinAttendue(maintenant, ancre)
            // Sans saut, en jouant sur la vitesse (comme l'accueil) : chaque saut faisait une micro-saccade.
            val ecart = ecartSigne(attendu - FIN_BOUCLE_DEBUT_MS, pos - FIN_BOUCLE_DEBUT_MS, FIN_BOUCLE_MS)
            suivi.suivre(v, attendu, ecart)
        }
    }
}

/** Les deux messages, écrits par l'appli dans le tiers bas, sur un voile sombre doux (comme l'aperçu validé). */
@Composable
private fun MessagesFin() {
    val voile = remember { Animatable(0f) }
    val merci = remember { Animatable(0f) }
    val bientot = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(MERCI_MS.toLong())
        voile.animateTo(1f, tween(APPARITION_TEXTE_MS, easing = FastOutSlowInEasing))
    }
    LaunchedEffect(Unit) {
        delay(MERCI_MS.toLong())
        merci.animateTo(1f, tween(APPARITION_TEXTE_MS, easing = FastOutSlowInEasing))
    }
    LaunchedEffect(Unit) {
        delay(A_BIENTOT_MS.toLong())
        bientot.animateTo(1f, tween(APPARITION_TEXTE_MS, easing = FastOutSlowInEasing))
    }
    Echelle(960.dp, 540.dp, Modifier.fillMaxSize()) {
        // Voile sur les 30 % du bas : transparent en haut, presque noir en bas.
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(162.dp)
                .graphicsLayer { alpha = voile.value }
                .background(Brush.verticalGradient(0f to Color.Transparent, 0.45f to VOILE_FIN.copy(alpha = 0.72f), 1f to VOILE_FIN.copy(alpha = 0.85f))),
        )
        Text(
            "Merci d'avoir participé !", maxLines = 1, softWrap = false,
            style = TextStyle(
                fontFamily = PoliceGsTexte, fontWeight = FontWeight.Bold, fontSize = 32.sp, color = GS.Encre, textAlign = TextAlign.Center,
                shadow = Shadow(Color.Black.copy(alpha = 0.8f), Offset.Zero, 18f),
            ),
            modifier = Modifier.align(Alignment.TopCenter).offset(y = 432.dp).graphicsLayer { alpha = merci.value },
        )
        Text(
            "À BIENTÔT SUR THE GAME SHOW !", maxLines = 1, softWrap = false,
            style = TextStyle(
                fontFamily = PoliceGsTitre, fontSize = 16.sp, color = GS.Cyan, textAlign = TextAlign.Center,
                shadow = Shadow(GS.Cyan, Offset.Zero, 24f),
            ),
            modifier = Modifier.align(Alignment.TopCenter).offset(y = 481.dp).graphicsLayer { alpha = bientot.value },
        )
    }
}

private val VOILE_FIN = Color(0xFF060310)

/**
 * Attente (ms) avant de lancer la vidéo, pour qu'elle parte sur le prochain temps de la musique : moins d'un temps,
 * et l'arrivée du robot (le clin d'œil dès la première seconde) n'est jamais coupée. 0 tant que la musique ne joue pas.
 */
internal fun attenteFin(maintenant: Long, tour: Long): Int =
    if (tour <= 0L) 0 else Math.floorMod(tour - maintenant, FIN_TEMPS_MS.toLong()).toInt()

/** Position attendue dans la boucle de la vidéo (de [FIN_BOUCLE_DEBUT_MS] à la fin), [ancre] : début d'un tour de boucle. */
internal fun positionFinAttendue(maintenant: Long, ancre: Long): Int =
    FIN_BOUCLE_DEBUT_MS + Math.floorMod(maintenant - ancre, FIN_BOUCLE_MS.toLong()).toInt()

/** Décale [ancre] d'au plus un demi-temps pour qu'elle tombe sur un temps de la musique ([tour] : début d'un de ses tours). */
internal fun ancreSurMusique(ancre: Long, tour: Long): Long {
    if (tour <= 0L) return ancre
    val d = Math.floorMod(tour - ancre, FIN_TEMPS_MS.toLong())
    return if (d * 2 >= FIN_TEMPS_MS) ancre + d - FIN_TEMPS_MS else ancre + d
}

/** Écart entre deux positions de la boucle (ms), en tenant compte du passage de la fin au début de la boucle. */
internal fun ecartBoucleFin(a: Int, b: Int): Int {
    val d = abs(a - b) % FIN_BOUCLE_MS
    return minOf(d, FIN_BOUCLE_MS - d)
}
