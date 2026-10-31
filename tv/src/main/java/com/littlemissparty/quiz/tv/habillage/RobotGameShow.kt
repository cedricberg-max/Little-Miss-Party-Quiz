package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.viewinterop.AndroidView
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.QuestionKind
import com.littlemissparty.quiz.tv.UiState
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin
import kotlin.random.Random

/**
 * Le robot animateur du design « The Game Show » : une vingtaine de courts clips pré-calculés (vidéos MP4 avec
 * transparence, res/raw/gs_robot_*.mp4, rendues depuis la maquette 3D du kit, lues par [LecteurAlpha]). À chaque
 * moment du jeu, un clip est tiré au hasard parmi ceux du moment, jamais le même deux fois de suite. Le robot est grand
 * (90 % de la hauteur de l'écran) et se déplace sur l'écran ([TrajetRobot]) ; pendant une question, il reste au bord
 * droit pour ne pas cacher les réponses. Rien ne se calcule en 3D sur la box : elle lit une petite vidéo, comme une
 * image, et la déplace (simple translation de calque, sans recomposition).
 * Jamais en design classique, jamais pendant une pause ; si le clip ne se lit pas, il n'y a simplement pas de robot :
 * la partie n'en dépend jamais. Le robot ne touche ni aux scores, ni au chrono, ni à la régie.
 */
enum class MomentRobot {
    /** Présentation d'un jeu. */
    MANCHE,
    /** Cinq dernières secondes du chrono, à chaque question (au bord droit). */
    SUSPENSE,
    /** Révélation sans aucune bonne réponse. */
    RATE,
    /** Révélation où toutes les équipes ont trouvé. */
    TOUS,
    /** Tableau des scores. */
    SCORES,
    /** Tableau des scores quand une autre équipe vient de passer en tête. */
    TETE,
    /** Annonce de la Super Finale (points multipliés). */
    SUPER_FINALE,
    /** Grand gagnant de la soirée, après l'annonce. */
    PODIUM,
    /** Bonus de l'animatrice, coffre gagnant ou coffre en or : il est content ([signalerRobot]). */
    BONUS,
    /** Malus de l'animatrice ou coffre perdant : il est déçu. */
    MALUS,
    /** La bombe des coffres approche : il a peur. */
    BOMBE,
    /** Pause : il vient régulièrement faire son numéro, tant que la pause dure. */
    PAUSE,
}

/**
 * Une étape du trajet : à [ms], le centre du robot est à [x] (fraction de la largeur de l'écran), son socle à [bas]
 * (fraction de la hauteur ; 1 = bord bas) et sa taille à [echelle]. Hors de [0, 1] : en dehors de l'écran.
 */
internal data class EtapeRobot(val ms: Int, val x: Float, val bas: Float, val echelle: Float = 1f)

/**
 * Le trajet d'un clip ; [sauts] = hauteur des petits bonds (fraction de l'écran), [periodeSautMs] leur rythme.
 * [fluide] : vol continu, sans s'arrêter aux étapes (vitesse horizontale constante, il ondule en hauteur).
 */
internal class TrajetRobot(val etapes: List<EtapeRobot>, val sauts: Float = 0f, val periodeSautMs: Int = 500, val fluide: Boolean = false) {
    val totalMs get() = etapes.last().ms

    /** Position (x, bas, échelle) à [ms] : passage en douceur d'une étape à l'autre, plus les bonds. */
    fun a(ms: Float): Triple<Float, Float, Float> {
        val i = etapes.indexOfLast { it.ms <= ms }.coerceIn(0, etapes.size - 2)
        val e0 = etapes[i]
        val e1 = etapes[i + 1]
        val u = ((ms - e0.ms) / (e1.ms - e0.ms)).coerceIn(0f, 1f)
        val d = u * u * (3 - 2 * u)
        val bond = if (sauts > 0f) sauts * abs(sin(PI.toFloat() * ms / periodeSautMs)) else 0f
        return Triple(e0.x + (e1.x - e0.x) * (if (fluide) u else d), e0.bas + (e1.bas - e0.bas) * d - bond, e0.echelle + (e1.echelle - e0.echelle) * d)
    }
}

/**
 * Écran de jeu avec beaucoup d'équipes (7 ou 8) : la grille des équipes descend jusqu'au bord droit, où il se pose.
 * Il garde son trajet mais se pose à [x] (bord droit) en plus petit ([facteur] de son échelle), sans cacher une carte
 * d'équipe ni le texte des réponses (vidéo de contrôle du 24 octobre ; cedric : robot plus petit à 8 équipes).
 */
internal class Resserre(val x: Float, val facteur: Float)

/** Le même trajet, posé à [Resserre.x] et réduit ; les entrées et sorties hors de l'écran restent hors de l'écran. */
internal fun TrajetRobot.resserre(r: Resserre) = TrajetRobot(
    etapes.map { e -> e.copy(x = if (e.x in 0f..1f) r.x else e.x, echelle = e.echelle * r.facteur) },
    sauts * r.facteur, periodeSautMs, fluide,
)

/** 7 équipes : la 4e carte s'arrête à x .86 ; 8 équipes : la colonne de droite va jusqu'à x .96, il n'en dépasse qu'à moitié. */
internal fun resserre(equipes: Int): Resserre? = when {
    equipes >= 8 -> Resserre(1f, 0.35f)
    equipes >= 7 -> Resserre(0.97f, 0.65f)
    else -> null
}

/** Un clip du catalogue : son fichier (res/raw), son moment et son trajet à l'écran, calé sur ses gestes. */
internal class ClipRobot(val fichier: String, val moment: MomentRobot, val trajet: TrajetRobot) {
    override fun toString() = fichier
}

/** Traverse l'écran en s'arrêtant à [arret] de [arriveeMs] à [departMs] ; [versLaGauche] : de droite à gauche. */
private fun traversee(arriveeMs: Int, departMs: Int, finMs: Int, versLaGauche: Boolean = false, arret: Float = 0.5f): TrajetRobot {
    val (debut, fin) = if (versLaGauche) 1.25f to -0.25f else -0.25f to 1.25f
    return TrajetRobot(listOf(EtapeRobot(0, debut, 1f), EtapeRobot(arriveeMs, arret, 1f), EtapeRobot(departMs, arret, 1f), EtapeRobot(finMs, fin, 1f)))
}

/**
 * Entre en dansant par le bord le plus proche jusqu'à [x], y danse jusqu'à [departMs], puis s'enfonce sous l'écran :
 * il ne traverse jamais le milieu (scores, pause) et ne repart pas à reculons.
 */
private fun auBordPuisDescend(x: Float, arriveeMs: Int, departMs: Int, finMs: Int, echelle: Float = 0.85f): TrajetRobot {
    val dehors = if (x > 0.5f) 1.25f else -0.25f
    val dessous = 1.05f + 0.9f * echelle
    return TrajetRobot(listOf(EtapeRobot(0, dehors, 1f, echelle), EtapeRobot(arriveeMs, x, 1f, echelle), EtapeRobot(departMs, x, 1f, echelle), EtapeRobot(finMs, x, dessous, echelle)))
}

/** Glisse depuis le bord le plus proche jusqu'à [x], y reste [dureeMs], puis repart par où il est venu. */
private fun auBord(x: Float, dureeMs: Int, echelle: Float = 0.85f, entreeMs: Int = 600, sortieMs: Int = 700, sauts: Float = 0f): TrajetRobot {
    val dehors = if (x > 0.5f) 1.25f else -0.25f
    return TrajetRobot(
        listOf(EtapeRobot(0, dehors, 1f, echelle), EtapeRobot(entreeMs, x, 1f, echelle), EtapeRobot(dureeMs, x, 1f, echelle), EtapeRobot(dureeMs + sortieMs, dehors, 1f, echelle)),
        sauts = sauts, periodeSautMs = 600,
    )
}

/** Surgit du bas de l'écran à [x], y reste jusqu'à [dureeMs], puis redescend. */
private fun duBas(x: Float, dureeMs: Int, echelle: Float = 0.85f, montee: Int = 700): TrajetRobot {
    val dessous = 1.05f + 0.9f * echelle
    return TrajetRobot(listOf(EtapeRobot(0, x, dessous, echelle), EtapeRobot(montee, x, 1f, echelle), EtapeRobot(dureeMs, x, 1f, echelle), EtapeRobot(dureeMs + 700, x, dessous, echelle)))
}

/** Descend du haut de l'écran à [x] (réacteurs allumés), se pose de [poseMs] à [decolleMs], puis remonte. */
private fun duHaut(x: Float, poseMs: Int, decolleMs: Int, finMs: Int, echelle: Float = 0.9f, bas: Float = 1f) =
    TrajetRobot(listOf(EtapeRobot(0, x, -0.02f, echelle), EtapeRobot(poseMs, x, bas, echelle), EtapeRobot(decolleMs, x, bas, echelle), EtapeRobot(finMs, x, -0.1f, echelle)))

/** En vol, il traverse l'écran de [x0] à [x1] en ondulant entre [hauts] (socle, fraction de la hauteur). */
private fun envol(x0: Float, x1: Float, finMs: Int, hauts: List<Float>, echelle: Float = 0.8f): TrajetRobot {
    val n = hauts.size - 1
    return TrajetRobot(hauts.mapIndexed { i, b -> EtapeRobot(finMs * i / n, x0 + (x1 - x0) * i / n, b, echelle) }, fluide = true)
}

/** Pique en diagonale depuis le haut ([x0]) et se pose à [x] de [poseMs] à [decolleMs], puis redécolle tout droit. */
private fun pique(x0: Float, x: Float, poseMs: Int, decolleMs: Int, finMs: Int, echelle: Float = 0.85f) =
    TrajetRobot(listOf(EtapeRobot(0, x0, -0.05f, echelle), EtapeRobot(poseMs, x, 1f, echelle), EtapeRobot(decolleMs, x, 1f, echelle), EtapeRobot(finMs, x, -0.1f, echelle)))

/** Surgit du bas à [x], se pose, puis décolle à la verticale à [decolleMs] (réacteurs allumés) et sort par le haut. */
private fun decolle(x: Float, decolleMs: Int, finMs: Int, echelle: Float = 0.85f): TrajetRobot {
    val dessous = 1.05f + 0.9f * echelle
    return TrajetRobot(listOf(EtapeRobot(0, x, dessous, echelle), EtapeRobot(600, x, 1f, echelle), EtapeRobot(decolleMs, x, 1f, echelle), EtapeRobot(finMs, x, -0.1f, echelle)))
}

/** Suspendu la tête en bas au haut de l'écran, à [x] : il descend, se balance, puis remonte. */
private fun suspendu(x: Float, dureeMs: Int, echelle: Float = 0.85f) =
    TrajetRobot(listOf(EtapeRobot(0, x, -0.02f, echelle), EtapeRobot(800, x, 0.61f, echelle), EtapeRobot(dureeMs, x, 0.61f, echelle), EtapeRobot(dureeMs + 700, x, -0.05f, echelle)))

/**
 * Le catalogue (22/10, après le test sur la vraie TV : « beaucoup plus d'animations, des mouvements de gauche à droite,
 * de haut en bas, des expressions selon les situations »). Chaque trajet suit le minutage de son clip
 * (gameshow/robot-clips.html) : par exemple « traverse » glisse jusqu'à 2,2 s, s'arrête face aux enfants, repart à 5 s.
 */
internal val CATALOGUE: List<ClipRobot> = listOf(
    // Présentation d'un jeu : il traverse en s'arrêtant à côté du titre (jamais dessus), ou descend du plafond, ou
    // surgit pour faire coucou (vidéo de contrôle du 24 octobre : titre, pictogramme et bouton restent lisibles).
    ClipRobot("gs_robot_traverse", MomentRobot.MANCHE, traversee(2_200, 5_000, 7_000, arret = 0.15f)),
    ClipRobot("gs_robot_traverseg", MomentRobot.MANCHE, traversee(2_200, 5_000, 7_000, versLaGauche = true, arret = 0.85f)),
    ClipRobot("gs_robot_descente", MomentRobot.MANCHE, duHaut(0.12f, 1_100, 4_600, 6_000)),
    ClipRobot("gs_robot_coucou", MomentRobot.MANCHE, duBas(0.11f, 3_900, echelle = 1f)),
    // C'est un robot qui vole (cedric) : il arrive aussi en volant, ou en piqué depuis le haut de l'écran.
    ClipRobot("gs_robot_vole", MomentRobot.MANCHE, envol(-0.25f, 1.25f, 6_000, listOf(0.62f, 0.8f, 0.66f, 0.82f, 0.58f))),
    ClipRobot("gs_robot_pique", MomentRobot.MANCHE, pique(0.95f, 0.22f, 1_300, 4_200, 5_500)),
    ClipRobot("gs_robot_salto", MomentRobot.MANCHE, duBas(0.14f, 2_900, echelle = 1f)),
    ClipRobot("gs_robot_guitare", MomentRobot.MANCHE, duBas(0.82f, 4_300, echelle = 1f)),
    ClipRobot("gs_robot_fusee", MomentRobot.MANCHE, decolle(0.8f, 1_300, 3_400)),
    // Suspense : au bord droit seulement, les réponses (texte à gauche des cartes) restent lisibles. Jamais d'air
    // inquiet ni triste ici (cedric, 23 octobre : les expressions négatives sont réservées aux moments négatifs) :
    // il guette, roule du tambour, scrute aux jumelles.
    // Bouche bée (cedric, 29/10, choix A) : il se fige, se penche vers les enfants, l'antenne clignote de plus en
    // plus vite, petit sursaut vers 3,5 s. 4 s de clip, sortie comprise il tient dans les 5 dernières secondes.
    ClipRobot("gs_robot_suspense", MomentRobot.SUSPENSE, auBord(0.92f, 4_000, echelle = 0.8f, entreeMs = 500)),
    ClipRobot("gs_robot_batterie", MomentRobot.SUSPENSE, auBord(0.92f, 3_300, echelle = 0.8f, entreeMs = 500)),
    ClipRobot("gs_robot_groove", MomentRobot.SUSPENSE, auBord(0.92f, 3_500, echelle = 0.8f, entreeMs = 500)),
    ClipRobot("gs_robot_jumelles", MomentRobot.SUSPENSE, auBord(0.92f, 3_300, echelle = 0.8f, entreeMs = 500)),
    // Personne n'a trouvé : un moment négatif, il est déçu (boude, se tape le front, se dégonfle…). Révélation : au bord
    // droit, au-delà du texte des réponses (au bord gauche il cachait la pastille et le texte de la réponse C).
    ClipRobot("gs_robot_rate", MomentRobot.RATE, auBord(0.93f, 3_000)),
    ClipRobot("gs_robot_oups", MomentRobot.RATE, auBord(0.93f, 4_500)),
    ClipRobot("gs_robot_pleure", MomentRobot.RATE, duBas(0.9f, 3_900)),
    ClipRobot("gs_robot_boude", MomentRobot.RATE, auBord(0.9f, 3_800)),
    ClipRobot("gs_robot_facepalm", MomentRobot.RATE, auBord(0.92f, 3_300)),
    ClipRobot("gs_robot_degonfle", MomentRobot.RATE, duBas(0.91f, 3_500)),
    // Tout le monde a trouvé.
    ClipRobot("gs_robot_applaudit", MomentRobot.TOUS, auBord(0.9f, 3_700)),
    ClipRobot("gs_robot_energie", MomentRobot.TOUS, duHaut(0.94f, 900, 3_900, 4_700, echelle = 0.85f, bas = 0.92f)),
    ClipRobot("gs_robot_pouces", MomentRobot.TOUS, duBas(0.9f, 3_700)),
    ClipRobot("gs_robot_bravo", MomentRobot.TOUS, auBord(0.96f, 3_500)),
    ClipRobot("gs_robot_coeur", MomentRobot.TOUS, duBas(0.96f, 3_300)),
    ClipRobot("gs_robot_salto", MomentRobot.TOUS, auBord(0.96f, 2_900)),
    ClipRobot("gs_robot_cestvous", MomentRobot.TOUS, auBord(0.92f, 3_300)),
    // Tableau des scores : les colonnes prennent toute la largeur ; il passe la tête par le bord, plus petit, sans
    // jamais cacher un score, un tube ou un nom (4 équipes), et ne s'arrête plus au milieu.
    ClipRobot("gs_robot_danse", MomentRobot.SCORES, auBordPuisDescend(0.04f, 2_400, 5_400, 6_100, echelle = 0.55f)),
    ClipRobot("gs_robot_robotdance", MomentRobot.SCORES, auBordPuisDescend(0.97f, 2_400, 5_400, 6_100, echelle = 0.6f)),
    ClipRobot("gs_robot_tourne", MomentRobot.SCORES, duBas(0.96f, 4_600, echelle = 0.55f)),
    ClipRobot("gs_robot_vole", MomentRobot.SCORES, envol(1.25f, -0.25f, 6_000, listOf(0.55f, 0.72f, 0.6f, 0.75f, 0.6f))),
    ClipRobot("gs_robot_pique", MomentRobot.SCORES, pique(0.95f, 0.97f, 1_300, 4_200, 5_500, echelle = 0.6f)),
    ClipRobot("gs_robot_disco", MomentRobot.SCORES, duBas(0.97f, 4_300, echelle = 0.75f)),
    ClipRobot("gs_robot_guitare", MomentRobot.SCORES, auBord(0.97f, 4_300, echelle = 0.6f)),
    ClipRobot("gs_robot_tete", MomentRobot.TETE, auBord(0.97f, 4_300, echelle = 0.85f)),
    ClipRobot("gs_robot_pique", MomentRobot.TETE, pique(0.95f, 0.97f, 1_300, 4_200, 5_500, echelle = 0.6f)),
    ClipRobot("gs_robot_cestvous", MomentRobot.TETE, auBord(0.96f, 3_300, echelle = 0.75f)),
    ClipRobot("gs_robot_bravo", MomentRobot.TETE, duBas(0.97f, 3_500, echelle = 0.6f)),
    ClipRobot("gs_robot_energie", MomentRobot.SUPER_FINALE, duHaut(0.9f, 900, 3_900, 4_700, echelle = 0.85f, bas = 0.92f)),
    ClipRobot("gs_robot_batterie", MomentRobot.SUPER_FINALE, duBas(0.9f, 3_300)),
    ClipRobot("gs_robot_guitare", MomentRobot.SUPER_FINALE, auBord(0.97f, 4_300, echelle = 0.5f)),
    // Grand gagnant : à côté du nom, qui reste au centre.
    ClipRobot("gs_robot_podium", MomentRobot.PODIUM, auBord(0.87f, 3_800, echelle = 1.05f, entreeMs = 1_200, sortieMs = 800, sauts = 0.05f)),
    ClipRobot("gs_robot_confettis", MomentRobot.PODIUM, auBord(0.14f, 3_900, echelle = 1f, entreeMs = 900)),
    ClipRobot("gs_robot_ola", MomentRobot.PODIUM, duBas(0.86f, 3_900, echelle = 1f)),
    ClipRobot("gs_robot_energie", MomentRobot.PODIUM, duHaut(0.86f, 900, 3_900, 4_700, echelle = 0.95f, bas = 0.92f)),
    ClipRobot("gs_robot_coeur", MomentRobot.PODIUM, auBord(0.86f, 3_300, echelle = 1f, entreeMs = 900)),
    ClipRobot("gs_robot_disco", MomentRobot.PODIUM, auBord(0.14f, 4_300, echelle = 1f, entreeMs = 900)),
    // Bonus, malus, coffres : jamais au centre (carte et coffre restent visibles) ; bonus et malus au bord droit, au-delà
    // du texte des réponses quand la carte de la régie passe sur une question. Il suit l'humeur du moment : content au
    // bonus, déçu au malus, apeuré par la bombe.
    ClipRobot("gs_robot_applaudit", MomentRobot.BONUS, auBord(0.9f, 3_700)),
    ClipRobot("gs_robot_pouces", MomentRobot.BONUS, duBas(0.9f, 3_700)),
    ClipRobot("gs_robot_confettis", MomentRobot.BONUS, auBord(0.96f, 3_900, entreeMs = 800)),
    ClipRobot("gs_robot_ola", MomentRobot.BONUS, duBas(0.96f, 3_900)),
    ClipRobot("gs_robot_energie", MomentRobot.BONUS, duHaut(0.96f, 900, 3_900, 4_700, echelle = 0.85f, bas = 0.92f)),
    ClipRobot("gs_robot_tourne", MomentRobot.BONUS, duBas(0.97f, 4_600)),
    ClipRobot("gs_robot_bravo", MomentRobot.BONUS, duBas(0.96f, 3_500)),
    ClipRobot("gs_robot_coeur", MomentRobot.BONUS, auBord(0.95f, 3_300)),
    ClipRobot("gs_robot_oups", MomentRobot.MALUS, auBord(0.93f, 4_500)),
    ClipRobot("gs_robot_pleure", MomentRobot.MALUS, duBas(0.9f, 3_900)),
    ClipRobot("gs_robot_rate", MomentRobot.MALUS, auBord(0.94f, 3_000)),
    ClipRobot("gs_robot_boude", MomentRobot.MALUS, auBord(0.9f, 3_800)),
    ClipRobot("gs_robot_facepalm", MomentRobot.MALUS, duBas(0.92f, 3_300)),
    ClipRobot("gs_robot_courtcircuit", MomentRobot.MALUS, auBord(0.96f, 3_300)),
    ClipRobot("gs_robot_degonfle", MomentRobot.MALUS, duBas(0.91f, 3_500)),
    ClipRobot("gs_robot_cache", MomentRobot.BOMBE, auBord(0.12f, 3_500, entreeMs = 500)),
    ClipRobot("gs_robot_inquiet", MomentRobot.BOMBE, auBord(0.88f, 3_500, entreeMs = 500)),
    ClipRobot("gs_robot_peur", MomentRobot.BOMBE, auBord(0.88f, 3_100, entreeMs = 500)),
    // Pause : le robot à l'honneur. Il vient régulièrement, par le haut, en volant, la tête en bas, en dansant (aux
    // bords : « Le chrono est arrêté » et le défi restent lisibles)…
    ClipRobot("gs_robot_dort", MomentRobot.PAUSE, duHaut(0.8f, 1_200, 5_200, 6_000, echelle = 0.85f, bas = 0.95f)),
    ClipRobot("gs_robot_envers", MomentRobot.PAUSE, suspendu(0.18f, 4_300)),
    ClipRobot("gs_robot_vole", MomentRobot.PAUSE, envol(-0.25f, 1.25f, 6_000, listOf(0.45f, 0.75f, 0.55f, 0.85f, 0.5f))),
    ClipRobot("gs_robot_pique", MomentRobot.PAUSE, pique(0.95f, 0.2f, 1_300, 4_200, 5_500)),
    ClipRobot("gs_robot_groove", MomentRobot.PAUSE, duBas(0.82f, 4_300)),
    ClipRobot("gs_robot_descente", MomentRobot.PAUSE, duHaut(0.78f, 1_100, 4_600, 6_000)),
    ClipRobot("gs_robot_energie", MomentRobot.PAUSE, duHaut(0.2f, 900, 3_900, 4_700, echelle = 0.85f, bas = 0.92f)),
    ClipRobot("gs_robot_coucou", MomentRobot.PAUSE, duBas(0.15f, 3_900)),
    ClipRobot("gs_robot_danse", MomentRobot.PAUSE, auBordPuisDescend(0.1f, 2_400, 5_400, 6_100)),
    ClipRobot("gs_robot_robotdance", MomentRobot.PAUSE, auBordPuisDescend(0.9f, 2_400, 5_400, 6_100)),
    ClipRobot("gs_robot_tourne", MomentRobot.PAUSE, duBas(0.85f, 4_600)),
    ClipRobot("gs_robot_ola", MomentRobot.PAUSE, duBas(0.15f, 3_900)),
    ClipRobot("gs_robot_confettis", MomentRobot.PAUSE, auBord(0.86f, 3_900, entreeMs = 800)),
    ClipRobot("gs_robot_pouces", MomentRobot.PAUSE, duBas(0.86f, 3_700)),
    ClipRobot("gs_robot_disco", MomentRobot.PAUSE, duBas(0.82f, 4_300)),
    ClipRobot("gs_robot_guitare", MomentRobot.PAUSE, duBas(0.18f, 4_300)),
    ClipRobot("gs_robot_jumelles", MomentRobot.PAUSE, duBas(0.18f, 3_300)),
    ClipRobot("gs_robot_fusee", MomentRobot.PAUSE, decolle(0.2f, 1_300, 3_400)),
    ClipRobot("gs_robot_salto", MomentRobot.PAUSE, duBas(0.85f, 2_900)),
)

/** Une réaction demandée par un autre écran ([signalerRobot]) ; [a] = heure de la demande sur la box. */
internal data class SignalRobot(val id: Int, val moment: MomentRobot, val a: Long) {
    val cle get() = "signal $id"
}

private var dernierSignal = 0

/** Réaction en attente ou en cours ; effacée quand son clip est fini. */
internal val signalRobot = mutableStateOf<SignalRobot?>(null)

/**
 * Fait réagir le robot par-dessus l'animation en cours (carte BONUS / MALUS, ouverture d'un coffre) : [BONUS],
 * [MALUS] ou [BOMBE]. Sans effet hors du design « The Game Show » ; une demande vieille de plus de 3 s est oubliée.
 */
fun signalerRobot(moment: MomentRobot) {
    signalRobot.value = SignalRobot(++dernierSignal, moment, System.currentTimeMillis())
}

/**
 * Tirage des clips : pour chaque moment, tous ses clips passent une fois dans un ordre au hasard avant qu'un clip
 * revienne, et jamais deux fois de suite le même (même d'un tour de mélange au suivant).
 */
internal class TirageRobot(private val alea: Random = Random.Default) {
    private val sacs = mutableMapOf<MomentRobot, ArrayDeque<ClipRobot>>()
    private val derniers = mutableMapOf<MomentRobot, ClipRobot>()

    fun suivant(moment: MomentRobot): ClipRobot? {
        val sac = sacs.getOrPut(moment) { ArrayDeque() }
        if (sac.isEmpty()) {
            val melange = CATALOGUE.filter { it.moment == moment }.shuffled(alea).toMutableList()
            if (melange.isEmpty()) return null
            if (melange.size > 1 && melange.first() == derniers[moment]) melange.add(melange.removeAt(0))
            sac.addAll(melange)
        }
        return sac.removeFirst().also { derniers[moment] = it }
    }
}

/** L'équipe seule en tête (au moins un point), ou null en cas d'égalité. */
internal fun meneur(scores: Map<String, Int>): String? {
    val max = scores.values.maxOrNull()?.takeIf { it > 0 } ?: return null
    return scores.filterValues { it == max }.keys.singleOrNull()
}

/** Le moment du robot pour cet écran (et sa clé : un clip par question, par jeu, par classement), ou null. */
// [ancienMeneur] : l'équipe en tête au classement précédent, pour fêter une équipe qui passe devant.
internal fun momentRobot(s: UiState.Playing, secondes: Int, ancienMeneur: String?): Pair<MomentRobot, String>? {
    if (s.paused) return null
    val q = s.question
    // Questions à réponses (quiz, Vrai ou Faux, Juste Chiffre…) : les jeux à plein écran (mimes, blind test, mini-jeux)
    // ont déjà leur propre mise en scène.
    val quiz = q != null && s.mime == null && s.blind == null && s.coffres == null &&
        q.kind in setOf(QuestionKind.CLASSIC, QuestionKind.EXPRESS, QuestionKind.NUMBER, QuestionKind.ZOOM, QuestionKind.FLOU)
    return when (s.phase) {
        Phase.QUESTION, Phase.CLOSED, Phase.REVEAL -> when {
            // Présentation d'un jeu : son intro vidéo montre déjà le robot qui y joue, pas de second robot par-dessus.
            s.intro -> if (nomIntroJeu(familleJeu(q)) != null) null else MomentRobot.MANCHE to "manche ${s.code} ${s.index}"
            quiz && s.phase == Phase.QUESTION && s.introUntil != null && s.factor > 1 -> MomentRobot.SUPER_FINALE to "finale ${s.code} ${q!!.id}"
            // Suspense seulement si une équipe n'a pas encore répondu : sinon, juste après une bonne réponse, le robot
            // inquiet passait pour un robot triste (cedric, 23 octobre).
            quiz && s.phase == Phase.QUESTION && secondes in 1..5 && s.teams.any { it.uid !in s.answered } -> MomentRobot.SUSPENSE to "suspense ${s.code} ${q!!.id}"
            quiz && s.phase == Phase.REVEAL && s.awards.isNotEmpty() && s.awards.values.none { it.correct } -> MomentRobot.RATE to "rate ${s.code} ${q!!.id}"
            quiz && s.phase == Phase.REVEAL && s.teams.isNotEmpty() && s.teams.all { s.awards[it.uid]?.correct == true } -> MomentRobot.TOUS to "tous ${s.code} ${q!!.id}"
            else -> null
        }
        Phase.SCORES -> when {
            s.blind != null -> null
            // Dès 6 équipes, le tableau des scores remplit l'écran : le robot y cachait un nom (cedric, 31/10).
            s.teams.size >= EQUIPES_SANS_ROBOT_SCORES -> null
            ancienMeneur != null && meneur(s.scores).let { it != null && it != ancienMeneur } -> MomentRobot.TETE to "scores ${s.code} ${s.index}"
            else -> MomentRobot.SCORES to "scores ${s.code} ${s.index}"
        }
        Phase.ENDED -> MomentRobot.PODIUM to "podium ${s.code}"
        Phase.LOBBY -> null
    }
}

/** À partir de ce nombre d'équipes, pas de robot sur le tableau des scores (de 1 à 5 équipes, il reste). */
internal const val EQUIPES_SANS_ROBOT_SCORES = 6

/** Clips déjà joués (par clé) : un même moment ne repasse pas si l'écran se recompose ou si la box se reconnecte. */
private val clipsJoues = mutableSetOf<String>()

/** Clip tiré pour chaque clé : tiré une seule fois, même si l'écran se recompose. */
private val clipsTires = mutableMapOf<String, ClipRobot?>()
private val tirage = TirageRobot()

/** Équipe en tête au dernier classement vu, par partie. */
private val meneurs = mutableMapOf<String, String>()

@Composable
fun RobotGameShow(state: UiState) {
    if (!Look.gs) return
    val s = state as? UiState.Playing ?: return
    val secondes = secondesRestantes(s)
    if (s.paused) return PauseRobot(s.code)
    // La grande intro du lancement a déjà son robot (et la box ne lit qu'une vidéo à la fois).
    if (Habillage.introLancement.value) return
    // Le podium a son propre robot, au-dessus du nom du gagnant (PodiumGameShow).
    if (s.phase == Phase.ENDED) return
    // Une réaction (bonus, malus, coffre) passe avant le reste, le temps de son clip.
    val signal = signalRobot.value?.takeIf { !s.paused && System.currentTimeMillis() - it.a < if (it.cle in clipsJoues) 10_000 else 3_000 }
    val (moment, cle) = signal?.let { it.moment to it.cle } ?: momentRobot(s, secondes, meneurs[s.code]) ?: return
    val clip = clipsTires.getOrPut(cle) {
        if (s.phase == Phase.SCORES) meneur(s.scores)?.let { meneurs[s.code] = it }
        tirage.suivant(moment)
    } ?: return
    // Podium : il attend que le grand gagnant soit annoncé.
    val attente = if (moment == MomentRobot.PODIUM) Tempo.FIN_VAINQUEUR + 400 else 0L
    val ecranDeJeu = s.phase == Phase.QUESTION || s.phase == Phase.CLOSED || s.phase == Phase.REVEAL
    val serre = if (ecranDeJeu && !s.intro && s.coffres == null && s.question?.isCoffres != true) resserre(s.teams.size) else null
    key(cle) {
        JouerClip(clip, cle, attente, serre) { if (signal != null && signalRobot.value == signal) signalRobot.value = null }
    }
}

/** Numéros de pause déjà commencés : chaque fin de numéro fait venir le suivant (y compris d'une pause à l'autre). */
private val tourPause = mutableStateOf(0)

/** Pause : un numéro au hasard toutes les quelques secondes, tant que la pause dure. */
@Composable
private fun PauseRobot(code: String) {
    val premier = remember { tourPause.value }
    val tour = tourPause.value
    val cle = "pause $code $tour"
    val clip = clipsTires.getOrPut(cle) { tirage.suivant(MomentRobot.PAUSE) } ?: return
    // Le premier vient vite ; ensuite il laisse respirer l'écran entre deux numéros.
    val attente = if (tour == premier) 1_500L else Random(tour).nextLong(3_000, 7_000)
    key(cle) { JouerClip(clip, cle, attente) { if (tourPause.value == tour) tourPause.value = tour + 1 } }
}

/**
 * Clips refaits plus larges (1040 × 1060 par moitié au lieu de 848) : le robot ne se coupe plus la main au bord
 * de l'image quand il tend les bras (cedric, 27/10 au soir). Même robot, même taille, juste plus de marge.
 */
private val CLIPS_LARGES = setOf(
    "gs_robot_confettis", "gs_robot_coucou", "gs_robot_danse", "gs_robot_descente", "gs_robot_dort", "gs_robot_energie",
    "gs_robot_ola", "gs_robot_podium", "gs_robot_robotdance", "gs_robot_tete", "gs_robot_tourne", "gs_robot_traverse",
    "gs_robot_vole", "gs_robot_batterie", "gs_robot_bravo", "gs_robot_coeur", "gs_robot_fusee", "gs_robot_guitare", "gs_robot_salto",
    "gs_robot_suspense",
)

/** La lueur sous le robot : largeur (part de la hauteur du clip), ellipse aplatie, hauteur du socle dans le clip, force. */
private const val LUEUR_LARGEUR = 0.32f
private const val LUEUR_APLATI = 0.2f
private const val LUEUR_HAUT = 0.08f
private const val LUEUR_ALPHA = 0.55f

/**
 * Force de la lueur au sol selon la hauteur du socle ([EtapeRobot.bas], 1 = posé au bas de l'écran) : pleine quand il
 * est posé, elle s'éteint dès qu'il s'élève (vol, tête en bas, piqué) et quand il plonge sous l'écran.
 */
internal fun lueurSol(bas: Float): Float =
    if (bas <= 1f) ((bas - 0.86f) / 0.12f).coerceIn(0f, 1f) else (1f - (bas - 1f) / 0.08f).coerceIn(0f, 1f)

/** Largeur / hauteur d'une moitié du clip (couleur au-dessus, transparence au-dessous). */
internal fun formatClip(fichier: String): Float = if (fichier in CLIPS_LARGES) 1040f / 1060f else 0.8f

@Composable
private fun JouerClip(clip: ClipRobot, cle: String, attenteMs: Long, serre: Resserre? = null, onFini: () -> Unit) {
    // Trajet fixé à l'arrivée du clip : il ne change pas de place en cours de route.
    val trajet = remember { serre?.let { clip.trajet.resserre(it) } ?: clip.trajet }
    val context = LocalContext.current
    val resId = remember(clip) { context.resources.getIdentifier(clip.fichier, "raw", context.packageName) }
    var visible by remember { mutableStateOf(false) }
    // 0 : en attente de la première image ; 1 : elle est à l'écran ; -1 : clip illisible.
    var lecture by remember { mutableStateOf(0) }
    val temps = remember { Animatable(0f) }
    LaunchedEffect(cle) {
        if (resId == 0 || !clipsJoues.add(cle)) {
            // Jamais en boucle serrée, même si un clip manque.
            delay(500)
            return@LaunchedEffect onFini()
        }
        delay(attenteMs)
        visible = true
        val pret = withTimeoutOrNull(3_000) { snapshotFlow { lecture }.first { it != 0 } }
        if (pret == 1) temps.animateTo(trajet.totalMs.toFloat(), tween(trajet.totalMs, easing = LinearEasing))
        visible = false
        onFini()
    }
    if (!visible) return
    BoxWithConstraints(Modifier.fillMaxSize().clearAndSetSemantics {}) {
        val largeur = constraints.maxWidth.toFloat()
        val hauteur = constraints.maxHeight.toFloat()
        // 90 % de la hauteur de l'écran, au format du clip (4:5, ou plus large pour les clips refaits avec de la marge).
        val h = maxHeight * 0.9f
        val hauteurPx = hauteur * 0.9f
        val format = formatClip(clip.fichier)
        // Lueur douce sur le sol brillant du studio, sous le socle, seulement quand il est posé (pas en vol) : un seul
        // dégradé gardé en cache, déplacé comme le robot par le calque (cedric, 28/10 : il ne flotte plus).
        val lueur = h * LUEUR_LARGEUR
        val lueurPx = hauteurPx * LUEUR_LARGEUR
        Box(
            Modifier.size(lueur).graphicsLayer {
                val (x, bas, echelle) = trajet.a(temps.value)
                scaleX = echelle
                scaleY = echelle * LUEUR_APLATI
                translationX = x * largeur - lueurPx / 2
                translationY = bas * hauteur - hauteurPx * echelle * LUEUR_HAUT - lueurPx / 2
                alpha = if (lecture == 1) (temps.value / 150f).coerceIn(0f, 1f) * lueurSol(bas) * LUEUR_ALPHA else 0f
            }.drawWithCache {
                val degrade = Brush.radialGradient(0f to Color(0xFFF4ECFF), 0.35f to Color(0x99B48CFF), 1f to Color.Transparent)
                onDrawBehind { drawCircle(degrade) }
            },
        )
        AndroidView(
            factory = { LecteurAlpha(it, resId, surDebut = { lecture = 1 }, surEchec = { lecture = -1 }) },
            onRelease = { it.liberer() },
            modifier = Modifier.size(h * format, h).graphicsLayer {
                val (x, bas, echelle) = trajet.a(temps.value)
                scaleX = echelle
                scaleY = echelle
                translationX = x * largeur - hauteurPx * format / 2
                translationY = bas * hauteur - hauteurPx / 2 - hauteurPx * echelle / 2
                alpha = if (lecture == 1) (temps.value / 150f).coerceIn(0f, 1f) else 0f
            },
        )
    }
}
