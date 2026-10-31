package com.littlemissparty.quiz.tv.habillage

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import com.littlemissparty.quiz.tv.R

/**
 * Les deux designs de l'appli (demande de cedric du 22 octobre) : « Classique » (Néon chic, celui d'avant, gardé tel
 * quel) et « The Game Show » (lumière noire, néons, robot présentateur, d'après le kit vidéo). On passe de l'un à
 * l'autre depuis le menu Retour de la TV ; le choix reste sur la box. Le déroulement des jeux ne change jamais : seuls
 * l'apparence et les sons suivent le design.
 */
enum class Design(val cle: String, val nom: String) {
    CLASSIQUE("classique", "Classique"),
    /** Le Game Show sur le décor dessiné (lumière noire, sol quadrillé) : le secours du plateau 3D. */
    GAME_SHOW("gs", "Game Show · décor dessiné"),
    /** Le Game Show sur le plateau 3D en vidéo (arche, tubes néon) : le design par défaut depuis le 24 octobre (cedric). */
    GAME_SHOW_3D("gs3d", "Game Show · plateau 3D"),
    ;

    /** Ordre du bouton du menu Retour : le plateau 3D, puis le décor dessiné, puis le Classique en secours. */
    val suivant: Design get() = when (this) {
        GAME_SHOW_3D -> GAME_SHOW
        GAME_SHOW -> CLASSIQUE
        CLASSIQUE -> GAME_SHOW_3D
    }

    companion object {
        /** Le design gardé sur la box ; sans choix, le Game Show sur le plateau 3D (cedric, 24 octobre). */
        fun depuis(cle: String?): Design = entries.firstOrNull { it.cle == cle } ?: GAME_SHOW_3D
    }
}

/** Design affiché. Lu par les couleurs et la police : changer de design redessine tout l'écran. */
object Look {
    var design by mutableStateOf(Design.GAME_SHOW_3D)
    /**
     * La box sait-elle lire deux vidéos à la fois (le plateau en fond et un clip du robot par-dessus) ? Mesuré au
     * démarrage ([videosSimultanees]). Sinon, le temps d'un clip, le plateau est figé sur sa dernière image ([GelFond]) :
     * le robot passe toujours et le plateau reste.
     */
    var deuxVideos by mutableStateOf(true)
    val gs: Boolean get() = design != Design.CLASSIQUE
    val fond3d: Boolean get() = design == Design.GAME_SHOW_3D
}

/** Charte « The Game Show » (kit vidéo du 22 octobre) : noir lumière noire, néons cyan et violet, 4 couleurs d'équipe. */
object GS {
    val Rose = Color(0xFFFF2D95)
    val Orange = Color(0xFFFF6B1A)
    val Vert = Color(0xFF39FF14)
    val Jaune = Color(0xFFFFE600)
    val Cyan = Color(0xFF00F0FF)
    val CyanClair = Color(0xFF8CF9FF)
    val CyanProfond = Color(0xFF00B4D8)
    val Violet = Color(0xFF8B2CFF)
    val VioletProfond = Color(0xFF3A0F7A)
    /** Fond de la scène, et des cartes (verre sombre). */
    val Noir = Color(0xFF05010D)
    val Nuit = Color(0xFF0E0820)
    val Encre = Color(0xFFF4F1FF)
    /**
     * Cadres sombres à texte clair (règle de cedric du 31/10, choix « Doux 2 ») : bleu nuit à 86 %, jamais noir pur, et
     * un texte blanc cassé, jamais blanc pur. Pour tous les cadres et ovales sombres qui portent un texte.
     */
    val Plaque = Color(0xDB263060)
    val PlaqueTexte = Color(0xFFE6EBF7)
    /** Juste / faux à la révélation. */
    val Juste = Color(0xFF39FF14)
    val JusteProfond = Color(0xFF16C60C)
    val JusteTexte = Color(0xFF031A00)
    val Faux = Color(0xFFFF3B5C)
    /** Les propositions A, B, C, D : les 4 néons du kit, dans l'ordre. */
    val Propositions = listOf(Rose, Orange, Vert, Jaune)
}

/**
 * Polices du Game Show (SIL OFL 1.1, assets/licences) : Rajdhani pour tous les textes (étroite, très lisible de loin),
 * Orbitron pour les chiffres et étiquettes, Bungee pour les grands titres, Rye pour le western du Duel des robots.
 */
val PoliceGsTexte = FontFamily(
    Font(R.font.lmp_gs_rajdhani_semibold, FontWeight.Medium),
    Font(R.font.lmp_gs_rajdhani_semibold, FontWeight.SemiBold),
    Font(R.font.lmp_gs_rajdhani_bold, FontWeight.Bold),
    Font(R.font.lmp_gs_rajdhani_bold, FontWeight.ExtraBold),
    Font(R.font.lmp_gs_rajdhani_bold, FontWeight.Black),
)
val PoliceGsChiffres = FontFamily(
    Font(R.font.lmp_gs_orbitron_bold, FontWeight.Bold),
    Font(R.font.lmp_gs_orbitron_black, FontWeight.ExtraBold),
    Font(R.font.lmp_gs_orbitron_black, FontWeight.Black),
)
val PoliceGsTitre = FontFamily(Font(R.font.lmp_gs_bungee, FontWeight.Normal))
val PoliceGsWestern = FontFamily(Font(R.font.lmp_gs_rye, FontWeight.Normal))

/** Classique ou Game Show : la valeur du design affiché. */
fun <T> selonLook(classique: T, gameShow: T): T = if (Look.gs) gameShow else classique

/**
 * Couleur d'équipe en néon (Game Show) : même teinte, saturée et à pleine lumière, pour briller sur le noir. Deux
 * équipes de teintes différentes restent différentes ; un gris ou un blanc reste clair.
 */
fun enNeon(c: Color): Color {
    val r = c.red; val g = c.green; val b = c.blue
    val max = maxOf(r, g, b); val min = minOf(r, g, b)
    val delta = max - min
    if (max <= 0f || delta / max < 0.12f) return Color(0xFFF4F1FF)
    val teinte = when (max) {
        r -> ((g - b) / delta).mod(6f)
        g -> (b - r) / delta + 2f
        else -> (r - g) / delta + 4f
    } * 60f
    val s = maxOf(delta / max, 0.88f)
    return hsv(teinte, s, 1f)
}

private fun hsv(h: Float, s: Float, v: Float): Color {
    val c = v * s
    val x = c * (1 - kotlin.math.abs((h / 60f).mod(2f) - 1))
    val m = v - c
    val (r, g, b) = when ((h / 60f).toInt().coerceIn(0, 5)) {
        0 -> Triple(c, x, 0f)
        1 -> Triple(x, c, 0f)
        2 -> Triple(0f, c, x)
        3 -> Triple(0f, x, c)
        4 -> Triple(x, 0f, c)
        else -> Triple(c, 0f, x)
    }
    return Color(r + m, g + m, b + m)
}
