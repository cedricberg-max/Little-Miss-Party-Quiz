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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.MimeCard
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.tv.habillage.Look
import com.littlemissparty.quiz.tv.habillage.PoliceGsTitre
import com.littlemissparty.quiz.tv.habillage.apparition
import com.littlemissparty.quiz.tv.habillage.panneauJeu

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
        modifier.panneauJeu().padding(horizontal = 24.dp, vertical = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Game Show : plus d'étiquette « QUI A DISPARU ? » au-dessus des objets, le titre le dit déjà (cedric, 25/10 au
        // soir : « n'a même pas lieu d'être ») ; « MÉMORISEZ ! » et « ABRACADABRA… » restent, ils disent l'étape.
        val repete = etape == EtapeDisparu.CHERCHER || etape == EtapeDisparu.REPONSE
        if (!(Look.gs && repete)) {
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
        }
        val colonnes = colonnesDisparu(q.cards.size)
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
    if (Look.gs) return CarteGs(carte, octets, etape, disparu, modifier)
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
                val largeurNom = maxWidth - 8.dp
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
                    // Le nom entier sur toute la largeur de la case, plus petit s'il est long (« Téléphérique »,
                    // « Bateau à voile », 25/10) : jamais de « … ».
                    TexteAjuste(
                        carte.word, color = if (enOr) Palette.Gold else Palette.Ink, max = 22.sp, min = 11.sp, lignes = 1,
                        fontWeight = FontWeight.Bold, modifier = Modifier.width(largeurNom),
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

/** Carte du Game Show (choix A de la planche du 27/10) : crème, bord doré, tuile blanche, mot en rose comme au Pictionary. */
private val CarteCreme = Brush.verticalGradient(listOf(Color(0xFFFFFAF0), Color(0xFFFDF1DC)))
private val CarteCachee = Brush.verticalGradient(listOf(Color(0xFF2A1650), Color(0xFF1A0D36)))
private val BordDore = Color(0xFFE9C48A)
private val BordTuile = Color(0xFFECE4F6)
private val MotRose = Color(0xFFFF2D8F)
private val QuestionDoree = Color(0xFFFFE27A)

/** Bord de la carte Game Show autour de sa tuile (côtés, haut + bas) et place du nom dessous, en dp. */
private const val CADRE_LARGEUR = 14f
private const val CADRE_HAUTEUR = 11f
private const val PLACE_NOM = 28f

/**
 * Côté de la tuile photo, carrée, d'une carte Game Show dans une case de [largeur] × [hauteur] dp : la carte prend
 * la taille de sa tuile, jamais une bande étroite où la photo serait coupée (test du 27/10 au soir : visages coupés).
 */
internal fun coteTuileDisparu(largeur: Float, hauteur: Float): Float =
    minOf(largeur - CADRE_LARGEUR, hauteur - CADRE_HAUTEUR - PLACE_NOM).coerceAtLeast(0f)

/**
 * Qui a disparu ? en Game Show : une vraie carte opaque, lisible de loin sur le plateau (cedric, planche du 27/10,
 * option A « carte du Pictionary »). La carte disparue devient violette, rayée, avec un « ? » doré ; à la révélation
 * l'objet revient sur sa carte crème, bordée d'or qui brille. La tuile est carrée et la photo y tient en entier,
 * sans rien couper (cedric, 27/10 au soir : « la plupart des visages sont coupés »).
 */
@Composable
private fun CarteGs(carte: MimeCard, octets: ByteArray?, etape: EtapeDisparu, disparu: Boolean, modifier: Modifier) {
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val cote = coteTuileDisparu(maxWidth.value, maxHeight.value)
        CarteGsCreme(
            carte, octets, etape, disparu,
            Modifier.width((cote + CADRE_LARGEUR).dp).height((cote + CADRE_HAUTEUR + PLACE_NOM).dp),
        )
    }
}

@Composable
private fun CarteGsCreme(carte: MimeCard, octets: ByteArray?, etape: EtapeDisparu, disparu: Boolean, modifier: Modifier) {
    val photo = photoCarte(octets, 240)
    val trou = disparu && etape == EtapeDisparu.CHERCHER
    val enOr = disparu && etape == EtapeDisparu.REPONSE
    val forme = RoundedCornerShape(14.dp)
    Column(
        modifier
            .shadow(if (enOr) 18.dp else 8.dp, forme, ambientColor = if (enOr) Palette.Gold else Color.Black, spotColor = if (enOr) Palette.Gold else Color.Black)
            .clip(forme)
            .background(if (trou) CarteCachee else CarteCreme)
            .border(if (enOr) 4.dp else 3.dp, if (enOr) Palette.Gold else BordDore, forme)
            .padding(start = 7.dp, end = 7.dp, top = 7.dp, bottom = 4.dp)
            .then(if (enOr) Modifier.apparition(0, "retour") else Modifier),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val tuile = RoundedCornerShape(10.dp)
        BoxWithConstraints(
            Modifier.weight(1f).fillMaxWidth().clip(tuile)
                .then(if (trou) Modifier.drawBehind { rayures() } else Modifier.background(Color.White))
                .border(1.5.dp, if (trou) BordDore else BordTuile, tuile),
            contentAlignment = Alignment.Center,
        ) {
            val taille = with(LocalDensity.current) { (maxHeight * 0.62f).coerceIn(16.dp, 56.dp).toSp() }
            when {
                etape == EtapeDisparu.MAGIE -> Text("✨", fontSize = taille, lineHeight = taille * 1.15f)
                trou -> Text(
                    "?", fontFamily = PoliceGsTitre, fontSize = taille, lineHeight = taille * 1.1f,
                    style = TextStyle(color = QuestionDoree, shadow = Shadow(Color(0xFFFFB347), blurRadius = 18f)),
                    modifier = Modifier.apparition(0, "trou"),
                )
                // La photo entière sur la tuile blanche : jamais de tête ou de visage coupé.
                photo != null -> Image(photo, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize().padding(3.dp))
                else -> Text(carte.image ?: "⭐", fontSize = taille, lineHeight = taille * 1.15f)
            }
        }
        // Le nom entier sur toute la largeur de la carte, plus petit s'il est long : jamais de « … ».
        CompositionLocalProvider(LocalTextStyle provides LocalTextStyle.current.copy(fontFamily = PoliceGsTitre)) {
            TexteAjuste(
                if (trou || etape == EtapeDisparu.MAGIE) "???" else carte.word.uppercase(),
                color = if (trou) QuestionDoree else MotRose, max = 17.sp, min = 9.sp, lignes = 1,
                fontWeight = FontWeight.Normal, modifier = Modifier.fillMaxWidth().padding(top = 3.dp),
            )
        }
    }
}

/** Rayures violettes en biais de la carte cachée. */
private fun DrawScope.rayures() {
    drawRect(Color(0xFF321C62))
    val pas = 14.dp.toPx()
    var x = -size.height
    while (x < size.width) {
        drawLine(Color(0xFF3A2170), Offset(x, size.height), Offset(x + size.height, 0f), strokeWidth = pas / 2)
        x += pas
    }
}

/**
 * Colonnes des objets : 4, 6 ou 8 objets (Régie PC, cedric 27/10) font 2 rangées égales (2+2, 3+3, 4+4) ; sinon les
 * lignes sont remplies et une dernière ligne incomplète est centrée, jamais un trou d'un côté.
 */
internal fun colonnesDisparu(n: Int): Int = when (n) {
    in 1..4 -> 2
    in 5..6, 9 -> 3
    else -> 4
}
