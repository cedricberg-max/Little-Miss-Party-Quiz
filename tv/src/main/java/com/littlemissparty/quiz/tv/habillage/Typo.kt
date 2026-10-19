package com.littlemissparty.quiz.tv.habillage

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.tv.R

/**
 * Police de toute l'appli (choix de cedric du 19 octobre, « cartes néon ») : Baloo 2, ronde, festive et très
 * lisible pour les enfants. Licence SIL OFL 1.1 (assets/licences/OFL-Baloo2.txt), embarquée : rien ne dépend
 * d'Internet. Deux graisses suffisent : demi-gras pour le contenu, extra-gras pour titres, noms et boutons
 * (Bold et Black se résolvent sur l'extra-gras).
 */
val PoliceLmp = FontFamily(
    Font(R.font.lmp_baloo_semibold, FontWeight.Medium),
    Font(R.font.lmp_baloo_semibold, FontWeight.SemiBold),
    Font(R.font.lmp_baloo_extrabold, FontWeight.Bold),
    Font(R.font.lmp_baloo_extrabold, FontWeight.ExtraBold),
    Font(R.font.lmp_baloo_extrabold, FontWeight.Black),
)

/** Donne la police Little Miss Party à tous les textes du dessous qui n'en imposent pas une autre. */
@Composable
fun AvecPoliceLmp(contenu: @Composable () -> Unit) {
    ProvideTextStyle(LocalTextStyle.current.merge(TextStyle(fontFamily = PoliceLmp)), contenu)
}

/**
 * Texte centré au pixel dans une pastille ou un bouton : sans la marge de police d'Android ni l'espace sous la
 * ligne, Baloo 2 (aux hautes jambages) tomberait trop bas.
 */
fun styleCentre(taille: TextUnit, couleur: Color, graisse: FontWeight = FontWeight.ExtraBold) = TextStyle(
    fontFamily = PoliceLmp, color = couleur, fontSize = taille, lineHeight = taille, fontWeight = graisse,
    platformStyle = PlatformTextStyle(includeFontPadding = false),
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.Both),
)

/** Couleurs des quatre indices de Qui suis-je (et de toute liste numérotée en cartes néon). */
val COULEURS_INDICES = listOf(Color(0xFF7CFF3A), Color(0xFFFF2D8A), Color(0xFFFFE61F), Color(0xFF2EE8E0))

/**
 * Une carte néon d'indice : le texte sur sa propre carte cerclée de la couleur de l'indice, avec une pastille
 * numérotée (chiffre centré) ; elle glisse de la gauche en arrivant. [taille] : taille du texte, que l'écran
 * réduit pour que les quatre indices tiennent.
 */
@Composable
fun CarteIndice(numero: Int, texte: String, modifier: Modifier = Modifier, taille: TextUnit = 28.sp) {
    val couleur = COULEURS_INDICES[(numero - 1).mod(COULEURS_INDICES.size)]
    val entree = remember(numero, texte) { Animatable(0f) }
    LaunchedEffect(numero, texte) { entree.animateTo(1f, spring(dampingRatio = 0.65f, stiffness = Spring.StiffnessMediumLow)) }
    val pastille: Dp = (taille.value * 1.45f).dp
    Row(
        modifier
            .graphicsLayer {
                alpha = entree.value.coerceIn(0f, 1f)
                translationX = (1f - entree.value) * -60.dp.toPx()
            }
            .shadow(14.dp, RoundedCornerShape(22.dp), ambientColor = couleur, spotColor = couleur)
            .clip(RoundedCornerShape(22.dp))
            .background(Neon.Nuit2)
            .border(3.dp, couleur, RoundedCornerShape(22.dp))
            .padding(horizontal = 18.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(pastille).clip(CircleShape).background(couleur), contentAlignment = Alignment.Center) {
            Text("$numero", style = styleCentre(taille * 0.8f, Neon.Nuit))
        }
        Spacer(Modifier.width(16.dp))
        Text(texte, style = TextStyle(fontFamily = PoliceLmp, color = Neon.Blanc, fontSize = taille, lineHeight = taille * 1.15f, fontWeight = FontWeight.ExtraBold))
    }
}

/**
 * Bouton « néon doré » (choix B de cedric) : au repos, fond de nuit cerclé d'or avec un léger halo doré et texte
 * or clair ([couleurTexteNeonDore]) ; sous le focus de la télécommande, plein or et texte nuit, comme partout.
 */
fun Modifier.boutonNeonDore(focus: Boolean, forme: Shape = RoundedCornerShape(18.dp)): Modifier =
    if (focus) {
        shadow(18.dp, forme, ambientColor = Neon.Or, spotColor = Neon.Or).clip(forme).background(Neon.Or).border(4.dp, Neon.Blanc, forme)
    } else {
        shadow(10.dp, forme, ambientColor = Neon.Or, spotColor = Neon.Or).clip(forme).background(Neon.Nuit2.copy(alpha = 0.85f)).border(3.dp, Neon.Or, forme)
    }

fun couleurTexteNeonDore(focus: Boolean): Color = if (focus) Neon.Nuit else Neon.OrClair
