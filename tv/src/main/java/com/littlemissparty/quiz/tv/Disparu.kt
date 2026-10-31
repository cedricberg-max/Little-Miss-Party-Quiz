package com.littlemissparty.quiz.tv

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.runtime.remember
import androidx.compose.foundation.Canvas
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Shadow
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
import com.littlemissparty.quiz.tv.habillage.QuestionPanneau3d
import com.littlemissparty.quiz.tv.habillage.planchesQuiz3d
import com.littlemissparty.quiz.tv.habillage.apparition
import com.littlemissparty.quiz.tv.habillage.panneauJeu
import kotlin.math.roundToInt

/**
 * Choix A de cedric (28/10, sur captures) : en Game Show, pas d'enseigne « Qui a disparu ? » au-dessus des cartes, elles
 * prennent sa hauteur. Éteinte = B, l'écran d'avant : seuls les tests l'éteignent, pour la comparaison.
 */
internal object PropositionDisparu {
    var sansEnseigne by mutableStateOf(true)
}

/** Choix A de cedric (28/10) : l'enseigne revient en grand au début de chaque grille, avant les cartes, ce temps-là. */
internal const val DISPARU_ENSEIGNE_DEBUT_MS = 2_000L

/**
 * Game Show, choix A (28/10) : sans l'enseigne pendant qu'on regarde les cartes, mais elle revient en grand au début de
 * chaque grille et pendant le tour de magie, quand il n'y a rien à voir (cedric : « elle est vraiment jolie »).
 */
internal fun enseigneDisparuVisible(etape: EtapeDisparu, ecouleMs: Long): Boolean =
    etape == EtapeDisparu.MAGIE || (etape == EtapeDisparu.MEMORISER && ecouleMs < DISPARU_ENSEIGNE_DEBUT_MS)

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
    val panneau = if (Look.gs && PropositionDisparu.sansEnseigne) planchesQuiz3d() else null
    val ecoule = q.durationMs - chronoRestant(q, state)
    Box(modifier) {
        Column(
            // Game Show : les cartes glissent de 24 dp vers la gauche, sur la grille des équipes en dessous (planche des onglets
            // d'appel, validée par cedric le 31/10 à 11:12 : elles étaient ~36 px de 1280 trop à droite). Même largeur.
            Modifier.fillMaxSize().padding(top = if (Look.gs) ETIQUETTE_DEBORD else 0.dp).panneauJeu()
                .padding(start = if (Look.gs) 0.dp else 24.dp, end = if (Look.gs) DECALAGE_CARTES_DISPARU * 2 else 24.dp, top = 14.dp, bottom = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Game Show : l'étiquette de l'étape est posée à cheval sur le haut du cadre, sans prendre de place : les cartes
            // gardent la même grande taille de « MÉMORISEZ ! » à la réponse (cedric, 30/10 : visages coupés pendant la
            // mémorisation, cartes plus grandes ensuite). Classique : au-dessus des objets, comme avant.
            if (!Look.gs) {
                EtiquetteEtape(etape)
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
                                i, q.cards[i], q.cards[i].imageId?.let { state.images[it] }, etape, disparu,
                                Modifier.weight(1f).fillMaxHeight().graphicsLayer { if (etape == EtapeDisparu.MAGIE) rotationZ = if (i % 2 == 0) tourne else -tourne },
                            )
                        }
                        if (vide > 0) Spacer(Modifier.weight(vide / 2f))
                    }
                }
            }
        }
        // Game Show : plus d'étiquette « QUI A DISPARU ? », le titre le dit déjà (cedric, 25/10 au soir : « n'a même pas
        // lieu d'être ») ; « MÉMORISEZ ! » et « ABRACADABRA… » restent, ils disent l'étape.
        if (Look.gs && etape != EtapeDisparu.CHERCHER && etape != EtapeDisparu.REPONSE) {
            EtiquetteEtape(etape, Modifier.align(Alignment.TopCenter))
        }
        // L'enseigne posée par-dessus (les cartes ne bougent pas) : en grand, puis elle s'efface quand les cartes reviennent.
        if (panneau != null) {
            val visible = enseigneDisparuVisible(etape, ecoule)
            val montre by animateFloatAsState(if (visible) 1f else 0f, tween(if (visible) 260 else 420), label = "enseigne")
            if (montre > 0.01f) {
                Box(
                    Modifier.fillMaxSize().graphicsLayer { alpha = montre }.background(Palette.Night.copy(alpha = 0.55f * montre)),
                    contentAlignment = Alignment.Center,
                ) {
                    QuestionPanneau3d(
                        panneau, q.text, festif = true,
                        modifier = Modifier.fillMaxWidth(0.92f).graphicsLayer { val e = 0.86f + 0.14f * montre; scaleX = e; scaleY = e },
                    )
                }
            }
        }
    }
}

/** Game Show : les cartes de Qui a disparu décalées vers la gauche d'autant (sur la grille des équipes). */
internal val DECALAGE_CARTES_DISPARU = 24.dp

/** Game Show : le cadre des objets descend d'autant, l'étiquette de l'étape est à cheval sur son bord haut. */
private val ETIQUETTE_DEBORD = 15.dp

/** « MÉMORISEZ ! », « ABRACADABRA… » ou « QUI A DISPARU ? » : l'étape en cours, dans sa pastille dorée. */
@Composable
private fun EtiquetteEtape(etape: EtapeDisparu, modifier: Modifier = Modifier) {
    Text(
        when (etape) {
            EtapeDisparu.MEMORISER -> "MÉMORISEZ !"
            EtapeDisparu.MAGIE -> "ABRACADABRA…"
            EtapeDisparu.CHERCHER -> "QUI A DISPARU ?"
            EtapeDisparu.REPONSE -> "QUI A DISPARU ?"
        },
        color = Palette.Night, fontSize = 18.sp, fontWeight = FontWeight.Black, maxLines = 1, softWrap = false,
        modifier = modifier.clip(RoundedCornerShape(50)).background(Palette.Gold).padding(horizontal = 14.dp, vertical = 4.dp)
            .apparition(0, etape),
    )
}

@Composable
private fun ObjetCase(rang: Int, carte: MimeCard, octets: ByteArray?, etape: EtapeDisparu, disparu: Boolean, modifier: Modifier) {
    if (Look.gs) return CarteGs(rang, carte, octets, etape, disparu, modifier)
    val photo = photoCarte(octets, PHOTO_CARTE_DISPARU)
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
                            photo, contentDescription = null, contentScale = ContentScale.Crop, alignment = CadrageHaut,
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
 * Cadrage des photos coupées pour remplir leur case (Mimes, Quiz illustré, Pictionary…) : vers le haut de l'image,
 * jamais au milieu, pour garder la tête et le visage d'un personnage (cedric, 27/10 au soir : le flamant des Mimes
 * avait la tête coupée).
 */
internal val CadrageHaut = BiasAlignment(0f, -0.6f)

/**
 * Photo d'une carte (Qui a disparu ?, Mimes) décodée une fois, réduite pour sa case : [cible] pixels de côté au
 * moins (la Mi Box a peu de mémoire). Null tant qu'elle n'est pas arrivée, ou si elle est abîmée.
 */
@Composable
internal fun photoCarte(octets: ByteArray?, cible: Int): ImageBitmap? = rememberPhoto(octets, cible)

/**
 * Carte du Game Show, « vitrine de nuit » (choix B de cedric, 29/10) : carte sombre au bord néon, l'image dans une
 * fenêtre claire qui brille, le nom en néon. Chaque carte a son néon.
 */
private val NeonsDisparu = listOf(
    Color(0xFFFF2D95), Color(0xFF00F0FF), Color(0xFF39FF14), Color(0xFFFFE600),
    Color(0xFF8B2CFF), Color(0xFFFF6B1A), Color(0xFFFF7AD9), Color(0xFF1E88FF),
)
internal fun neonDisparu(rang: Int): Color = NeonsDisparu[rang.mod(NeonsDisparu.size)]
private val CarteNuit = Brush.verticalGradient(listOf(Color(0xFF24113F), Color(0xFF0E0820)))
private val Fenetre = Brush.radialGradient(0f to Color.White, 0.6f to Color(0xFFF1EAFF), 1f to Color(0xFFDDD0FF))
private val BordDore = Color(0xFFE9C48A)
private val QuestionDoree = Color(0xFFFFE27A)

/**
 * Taille de la photo [largeurPhoto] × [hauteurPhoto] posée en entier dans la tuile [largeur] × [hauteur] : la plus
 * grande possible sans rien couper, ni le haut ni les côtés (test du 27/10 au soir : têtes et visages coupés).
 */
internal fun photoDansTuile(largeur: Float, hauteur: Float, largeurPhoto: Float, hauteurPhoto: Float): Pair<Float, Float> {
    if (largeur <= 0f || hauteur <= 0f || largeurPhoto <= 0f || hauteurPhoto <= 0f) return 0f to 0f
    val k = minOf(largeur / largeurPhoto, hauteur / hauteurPhoto)
    return largeurPhoto * k to hauteurPhoto * k
}

/**
 * Partie de la photo [largeurPhoto] × [hauteurPhoto] qui remplit toute la fenêtre [largeur] × [hauteur] (une photo
 * complète remplit la carte, cedric 29/10), recadrée vers le haut pour garder les visages : (x, y, l, h) en pixels.
 */
internal fun photoQuiRemplit(largeur: Float, hauteur: Float, largeurPhoto: Int, hauteurPhoto: Int): IntArray {
    if (largeur <= 0f || hauteur <= 0f || largeurPhoto <= 0 || hauteurPhoto <= 0) return intArrayOf(0, 0, largeurPhoto.coerceAtLeast(0), hauteurPhoto.coerceAtLeast(0))
    val k = maxOf(largeur / largeurPhoto, hauteur / hauteurPhoto)
    // Arrondi, pas troncature : 120 / (120 / 400) vaut 399,99997 en Float, il ne faut pas perdre la dernière colonne.
    val l = (largeur / k).roundToInt().coerceIn(1, largeurPhoto)
    val h = (hauteur / k).roundToInt().coerceIn(1, hauteurPhoto)
    val x = (largeurPhoto - l) / 2
    // Même cadrage que les autres jeux : vers le haut (CadrageHaut, −0,6).
    val y = ((hauteurPhoto - h) * 0.2f).toInt()
    return intArrayOf(x, y, l, h)
}

/**
 * Image détourée ou dessin sur fond blanc (les quatre coins transparents ou presque blancs) : elle se pose entière,
 * fondue dans la fenêtre (le blanc prend la couleur de la fenêtre). Sinon c'est une photo : elle remplit la fenêtre.
 * [coins] : couleurs ARGB des quatre coins.
 */
internal fun imageDetouree(coins: IntArray): Boolean = coins.isNotEmpty() && coins.all { c ->
    val a = c ushr 24 and 0xFF
    val r = c shr 16 and 0xFF
    val g = c shr 8 and 0xFF
    val b = c and 0xFF
    a < 40 || (r >= 232 && g >= 232 && b >= 232)
}

private fun coinsDe(photo: ImageBitmap): IntArray = runCatching {
    val b = photo.asAndroidBitmap()
    val m = 2.coerceAtMost(minOf(b.width, b.height) - 1)
    intArrayOf(b.getPixel(m, m), b.getPixel(b.width - 1 - m, m), b.getPixel(m, b.height - 1 - m), b.getPixel(b.width - 1 - m, b.height - 1 - m))
}.getOrDefault(IntArray(0))

/**
 * Qui a disparu ? en Game Show, « vitrine de nuit » (choix B de cedric, 29/10) : une carte sombre au bord néon de sa
 * couleur, l'objet dans une fenêtre claire qui brille, le nom en néon. Une photo remplit la fenêtre (recadrée vers le
 * haut, la Régie PC permet de la recadrer) ; un émoji ou une image détourée sur fond blanc y est posé entier et fondu
 * (le blanc disparaît). La carte disparue devient violette, rayée, avec un « ? » doré ; à la révélation l'objet revient
 * avec un contour blanc qui brille.
 */
@Composable
private fun CarteGs(rang: Int, carte: MimeCard, octets: ByteArray?, etape: EtapeDisparu, disparu: Boolean, modifier: Modifier) {
    val photo = photoCarte(octets, PHOTO_CARTE_DISPARU)
    val detouree = remember(photo) { photo?.let { imageDetouree(coinsDe(it)) } ?: false }
    val trou = disparu && etape == EtapeDisparu.CHERCHER
    val revient = disparu && etape == EtapeDisparu.REPONSE
    val neon = neonDisparu(rang)
    val forme = RoundedCornerShape(14.dp)
    Column(
        modifier
            .shadow(if (revient) 20.dp else 10.dp, forme, ambientColor = if (revient) Color.White else neon, spotColor = if (revient) Color.White else neon)
            .clip(forme)
            .background(CarteNuit)
            .border(if (revient) 4.dp else 2.5.dp, if (revient) Color.White else neon, forme)
            .padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 4.dp)
            .then(if (revient) Modifier.apparition(0, "retour") else Modifier),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val tuile = RoundedCornerShape(10.dp)
        BoxWithConstraints(
            Modifier.weight(1f).fillMaxWidth()
                .shadow(8.dp, tuile, ambientColor = neon, spotColor = neon)
                .clip(tuile)
                .then(if (trou) Modifier.drawBehind { rayures() } else Modifier.background(Fenetre))
                .border(1.5.dp, if (trou) BordDore else neon.copy(alpha = 0.67f), tuile),
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
                // Détourée ou dessin sur fond blanc : entière, fondue dans la fenêtre (le blanc prend sa couleur).
                photo != null && detouree -> {
                    val (l, h) = photoDansTuile((maxWidth - 8.dp).value, (maxHeight - 8.dp).value, photo.width.toFloat(), photo.height.toFloat())
                    Canvas(Modifier.size(l.dp, h.dp)) {
                        drawImage(photo, dstSize = IntSize(size.width.toInt(), size.height.toInt()), blendMode = BlendMode.Multiply)
                    }
                }
                // Une photo complète remplit la fenêtre.
                photo != null -> Canvas(Modifier.fillMaxSize()) {
                    val (x, y, l, h) = photoQuiRemplit(size.width, size.height, photo.width, photo.height).toList()
                    drawImage(photo, IntOffset(x, y), IntSize(l, h), dstSize = IntSize(size.width.toInt(), size.height.toInt()))
                }
                else -> Text(carte.image ?: "⭐", fontSize = taille, lineHeight = taille * 1.15f)
            }
        }
        // Le nom entier sur toute la largeur de la carte, plus petit s'il est long : jamais de « … ».
        CompositionLocalProvider(LocalTextStyle provides LocalTextStyle.current.copy(fontFamily = PoliceGsTitre, shadow = Shadow(neon, blurRadius = 16f))) {
            TexteAjuste(
                if (trou || etape == EtapeDisparu.MAGIE) "???" else carte.word.uppercase(),
                color = if (trou) QuestionDoree else Color.White, max = 17.sp, min = 9.sp, lignes = 1,
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
