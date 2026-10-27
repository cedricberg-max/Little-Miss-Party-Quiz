package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.engine.QuestionKind
import com.littlemissparty.quiz.tv.R
import kotlinx.coroutines.delay

/**
 * Famille du jeu d'après sa première question : sert à l'emblème (design classique) et à l'intro vidéo (Game Show).
 * Quiz illustré : un quiz classique dont les réponses sont des images.
 */
internal fun familleJeu(q: Question?): String = familleType(q?.kind, musique = q?.audioId != null, images = q?.choiceImages?.any { it != null } == true)

/** La même chose d'après le type de jeu seul ([musique] : un extrait à écouter ; [images] : des réponses en photos). */
internal fun familleType(kind: QuestionKind?, musique: Boolean = false, images: Boolean = false): String = when (kind) {
    QuestionKind.MIME -> "mimes"
    QuestionKind.PICTIONARY -> "pictionary"
    QuestionKind.BLIND -> "blind"
    QuestionKind.NUMBER -> "juste"
    QuestionKind.EXPRESS -> "express"
    QuestionKind.ZOOM -> "zoom"
    QuestionKind.FLOU -> "flou"
    QuestionKind.CHANTE -> "chante"
    QuestionKind.QUISUIS -> "quisuis"
    QuestionKind.DISPARU -> "disparu"
    QuestionKind.STATUES -> "statues"
    QuestionKind.PORTES -> "portes"
    QuestionKind.COFFRES -> "bombe"
    QuestionKind.GONFLEUR -> "gonfleur"
    QuestionKind.PATATE -> "patate"
    QuestionKind.DUEL -> "duel"
    QuestionKind.SIMON -> "simon"
    else -> when {
        musique -> "musical"
        images -> "illustre"
        else -> "quiz"
    }
}

/**
 * Nom de l'intro vidéo d'une famille de jeu (res/raw/gs_intro_<nom>.mp4), ou null : Juste Chiffre et les Portes n'en
 * ont pas, leur écran de présentation dessiné reste.
 */
internal fun nomIntroJeu(famille: String): String? = when (famille) {
    "quiz" -> "quiz"
    "illustre" -> "illustre"
    "musical" -> "musical"
    "blind" -> "blind"
    "express" -> "vraifaux"
    "zoom" -> "zoom"
    "flou" -> "floue"
    "chante" -> "chante"
    "quisuis" -> "quisuisje"
    "disparu" -> "disparu"
    "statues" -> "statues"
    "pictionary" -> "picto"
    "mimes" -> "mimes"
    "patate" -> "patate"
    "bombe" -> "coffres"
    "gonfleur" -> "gonfleur"
    "duel" -> "duel"
    "simon" -> "simon"
    else -> null
}

private fun ressourceIntroJeu(nom: String): Int = when (nom) {
    "quiz" -> R.raw.gs_intro_quiz
    "illustre" -> R.raw.gs_intro_illustre
    "musical" -> R.raw.gs_intro_musical
    "blind" -> R.raw.gs_intro_blind
    "vraifaux" -> R.raw.gs_intro_vraifaux
    "zoom" -> R.raw.gs_intro_zoom
    "floue" -> R.raw.gs_intro_floue
    "chante" -> R.raw.gs_intro_chante
    "quisuisje" -> R.raw.gs_intro_quisuisje
    "disparu" -> R.raw.gs_intro_disparu
    "statues" -> R.raw.gs_intro_statues
    "picto" -> R.raw.gs_intro_picto
    "mimes" -> R.raw.gs_intro_mimes
    "patate" -> R.raw.gs_intro_patate
    "coffres" -> R.raw.gs_intro_coffres
    "duel" -> R.raw.gs_intro_duel
    "simon" -> R.raw.gs_intro_simon
    else -> R.raw.gs_intro_gonfleur
}

/**
 * Intro jouée une seule fois puis tenue sur sa fin (ms où elle reprend en boucle), ou null : en boucle entière.
 * Duel des robots : 21,7 s avec le titre à la fin, les 2 dernières secondes figées tournent sans fin.
 */
internal fun repriseIntroJeu(nom: String): Int? = if (nom == "duel") REPRISE_INTRO_DUEL_MS else null
internal const val REPRISE_INTRO_DUEL_MS = 19_800

/** Le temps de laisser la grande intro du lancement prendre l'écran, si c'est le premier jeu de la fête. */
internal const val DELAI_INTRO_JEU_MS = 300L
private const val FONDU_INTRO_JEU_MS = 400
/** Place du nom du jeu, en bas à gauche : il s'arrête avant le bouton « Lancer l'épreuve » de l'animatrice. */
private val LARGEUR_TITRE_INTRO = 520.dp

/**
 * Intro d'un jeu, design « The Game Show » (cedric, 24 octobre : l'intro fait office d'emblème) : la vidéo du jeu,
 * rendue à l'avance en 3D (16 s en boucle, muette : le robot y joue au jeu), en plein écran, et « PROCHAIN JEU » et le
 * nom du jeu écrits en direct en bas à gauche, sur le sol du plateau, sous le robot et à gauche du bouton de
 * l'animatrice. [video] faux (pause) : la vidéo s'arrête. Elle attend [DELAI_INTRO_JEU_MS] puis apparaît en fondu ;
 * pendant ce temps le décor du dessous ne lit pas son propre fond vidéo ([Habillage.introJeu] : une vidéo à la fois).
 * Si elle ne se lit pas, l'écran dessiné d'avant revient. Aucun son, rien de focalisable.
 */
@Composable
internal fun IntroJeuGameShow(titre: String, famille: String, nom: String, video: Boolean, modifier: Modifier = Modifier) {
    var echec by remember(nom) { mutableStateOf(false) }
    // Vidéo qui lâche (test du 25/10 au soir : Gonfleur fou, l'écran dessiné restait figé) : relancée, plusieurs fois ;
    // l'écran dessiné tient la place en attendant. La vidéo tourne en boucle jusqu'à « Lancer l'épreuve ».
    var essai by remember(nom) { mutableIntStateOf(0) }
    LaunchedEffect(echec, nom) {
        if (echec && essai < ESSAIS_INTRO_JEU) {
            delay(RELANCE_INTRO_JEU_MS)
            essai++
            echec = false
        }
    }
    val actif = video && !Habillage.introLancement.value
    // Avant le repli : pendant une relance, le décor ne rouvre pas son propre fond vidéo (une vidéo à la fois).
    DisposableEffect(actif) {
        Habillage.introJeu.value = actif
        onDispose { Habillage.introJeu.value = false }
    }
    if (echec) return PresentationJeuGameShow(titre, famille, modifier)
    var lancee by remember(nom) { mutableStateOf(false) }
    LaunchedEffect(actif, nom) {
        lancee = false
        if (actif) {
            delay(DELAI_INTRO_JEU_MS)
            lancee = true
        }
    }
    var prete by remember(nom, lancee, essai) { mutableStateOf(false) }
    val opacite = remember(nom, lancee, essai) { Animatable(0f) }
    LaunchedEffect(prete) { if (prete) opacite.animateTo(1f, tween(FONDU_INTRO_JEU_MS)) }
    val embleme = emblemeJeu(famille)
    val couleur = if (embleme.couleur == Color(0xFFF0CC92)) GS.Rose else enNeon(embleme.couleur)
    Box(modifier.fillMaxSize()) {
        if (lancee) key(essai) {
            AndroidView(
                factory = {
                    LecteurFond(
                        it, ressourceIntroJeu(nom), surPret = { prete = true }, repriseMs = repriseIntroJeu(nom),
                        surEchec = {
                            Sons.incident("Intro du jeu « $nom » : la vidéo a lâché (${GelFond.fondsOuverts} vidéos ouvertes), essai ${essai + 1}")
                            echec = true
                        },
                    )
                },
                update = { it.alpha = opacite.value },
                onRelease = { it.liberer() },
                modifier = Modifier.fillMaxSize(),
            )
        }
        TitreIntroJeu(titre, couleur)
    }
}

/** Relances d'une intro de jeu qui lâche, puis l'écran dessiné reste. */
internal const val ESSAIS_INTRO_JEU = 6
private const val RELANCE_INTRO_JEU_MS = 1_500L

@Composable
private fun TitreIntroJeu(titre: String, couleur: Color) {
    val mesure = rememberTextMeasurer()
    Echelle(960.dp, 540.dp, Modifier.fillMaxSize()) {
        // Voile sombre sur le bas de l'image : le nom se lit quelle que soit l'image de la vidéo.
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(170.dp)
                .background(Brush.verticalGradient(listOf(Color.Transparent, GS.Noir.copy(alpha = 0.85f)))),
        )
        val densite = LocalDensity.current
        // La plus grande taille où le nom tient sur une ligne ; au-delà, deux lignes en 30 sp.
        val taille = remember(titre, couleur, densite) {
            val place = with(densite) { LARGEUR_TITRE_INTRO.roundToPx() }
            (54 downTo 30 step 2).firstOrNull { t ->
                mesure.measure(titre, styleTitreNeon(t.sp, couleur, TextAlign.Start), maxLines = 1, softWrap = false).size.width <= place
            }?.sp ?: 30.sp
        }
        Column(Modifier.align(Alignment.BottomStart).padding(start = 40.dp, bottom = 28.dp).widthIn(max = LARGEUR_TITRE_INTRO)) {
            Text("PROCHAIN JEU", maxLines = 1, softWrap = false, style = styleEtiquetteGs(18.sp, GS.Cyan, 8.sp), modifier = Modifier.apparition(0, titre))
            Spacer(Modifier.height(6.dp))
            Text(
                titre, maxLines = 2, overflow = TextOverflow.Ellipsis, style = styleTitreNeon(taille, couleur, TextAlign.Start),
                modifier = Modifier.apparition(250, titre),
            )
        }
    }
}
