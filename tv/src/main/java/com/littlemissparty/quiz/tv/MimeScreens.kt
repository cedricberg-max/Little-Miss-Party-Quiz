package com.littlemissparty.quiz.tv

import com.littlemissparty.quiz.tv.habillage.Look
import com.littlemissparty.quiz.tv.habillage.logoNeonJeu
import androidx.compose.ui.res.painterResource
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.MimeCard
import com.littlemissparty.quiz.engine.Scoring
import com.littlemissparty.quiz.tv.habillage.BandeauEquipes
import com.littlemissparty.quiz.tv.habillage.Gerbe
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.Tampon
import com.littlemissparty.quiz.tv.habillage.Tempo
import com.littlemissparty.quiz.tv.habillage.apparition
import com.littlemissparty.quiz.tv.habillage.apres
import com.littlemissparty.quiz.tv.habillage.TexteJauge
import com.littlemissparty.quiz.tv.habillage.rebond
import com.littlemissparty.quiz.tv.habillage.styleCentre
import kotlinx.coroutines.delay
import com.littlemissparty.quiz.tv.habillage.PoliceLmp

/*
 * Manche de mimes sur la TV. Mimes en file (cedric, 26/10) : les joueurs de l'équipe à la queue leu leu, le mimeur
 * face à l'écran voit une très grande image et son mot et mime pour les trois suivants, dos à l'écran. Trouvé ou passé :
 * l'écran se vide le temps que les joueurs tournent, puis Sarah montre l'image suivante. L'écran ne décide rien : il affiche l'état du moteur (équipe qui joue,
 * carte, compteurs, chrono calé sur le serveur). La télécommande reste un secours de la régie.
 */

@Composable
fun MimeScreen(state: UiState.Playing, actions: TvActions) {
    val m = state.mime ?: return
    val team = state.teams.find { it.uid == m.team }
    Box(Modifier.fillMaxSize()) {
        // Halo de la couleur de l'équipe qui joue, qui respire doucement derrière la carte.
        if (team != null) TeamGlow(team.color.toColor())
        Column(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 24.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "MIMES",
                    color = Palette.Night, fontSize = 20.sp, fontWeight = FontWeight.Black, letterSpacing = 3.sp,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(Neon.Or).padding(horizontal = 16.dp, vertical = 4.dp),
                )
                Spacer(Modifier.width(14.dp))
                Text(
                    sousTitreMimes(state.question?.text).orEmpty(), color = Palette.InkSoft, fontSize = 22.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                if (team != null) MimeCountdown(state)
            }
            Spacer(Modifier.height(8.dp))
            // Le bandeau des équipes est mesuré d'abord : ses boutons gardent toujours leur hauteur (cedric, 24/10 :
            // « Image suivante » rogné sous une carte avec photo et mot sur deux lignes) ; la carte prend le reste.
            if (team != null) Turn(state, m, team, Modifier.weight(1f)) else BetweenTurns(state, m, Modifier.weight(1f))
            Spacer(Modifier.height(12.dp))
            // De 1 à 8 équipes : les pastilles passent au-dessus des boutons quand elles ne tiennent plus à côté.
            BandeauEquipes(
                nombre = state.teams.size,
                modifier = Modifier.fillMaxWidth(),
                // En pause, le seul bouton est « Reprendre » sur l'intermède.
                actions = { if (!state.paused) MimeButtons(state, m, actions) },
            ) { i, compacte, mod ->
                val t = state.teams.getOrNull(i) ?: return@BandeauEquipes
                MimeTeamChip(t, m.counts[t.uid] ?: 0, playing = t.uid == m.team, passed = t.uid in m.turns, compacte = compacte, modifier = mod)
            }
        }
        // « TOP DÉPART ! » claque au début de chaque tour, « TEMPS ÉCOULÉ ! » à la fin, calés sur les sifflets.
        Tampon("TOP DÉPART !", cle = "top ${m.team} ${m.turns.size}", actif = team != null)
        Tampon("TEMPS ÉCOULÉ !", cle = "fin ${m.turns.size}", couleur = Neon.Halo, actif = team == null && m.last != null)
    }
}

/** Tour en cours : « Au tour des Licornes ! », la carte en très grand et le compteur de mimes trouvés. */
@Composable
private fun Turn(state: UiState.Playing, m: MimeUi, team: Team, modifier: Modifier = Modifier) {
    val color = team.color.toColor()
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.reduitSiTropHaut(), horizontalAlignment = Alignment.CenterHorizontally) {
            // « Au tour de » seul, puis le nom de l'équipe dans sa couleur (n° 18 du 31/10 : plus de « Au tour de Les… »),
            // posés sur le décor « comme les jauges ».
            TexteJauge("Au tour de", color = Palette.Ink, fontSize = 22.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            TexteAjuste(
                team.name, color = color, max = 30.sp, min = 18.sp, lignes = 1, jauge = true,
                modifier = Modifier.fillMaxWidth(0.9f),
            )
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                MimeCardView(m, color, state.images)
                FoundCounter(m.found)
            }
        }
    }
}

/**
 * Hauteur qui manque (beaucoup d'équipes, photo et mot sur deux lignes) : le contenu rapetisse en entier, depuis le
 * haut, au lieu d'être rogné. Sans clip : les animations de la carte peuvent toujours déborder.
 */
private fun Modifier.reduitSiTropHaut() = layout { mesurable, contraintes ->
    val p = mesurable.measure(contraintes.copy(minHeight = 0, maxHeight = Constraints.Infinity))
    if (!contraintes.hasBoundedHeight || p.height <= contraintes.maxHeight) {
        layout(p.width, p.height) { p.place(0, 0) }
    } else {
        val echelle = contraintes.maxHeight.toFloat() / p.height
        layout(p.width, contraintes.maxHeight) {
            p.placeWithLayer(0, 0) {
                scaleX = echelle
                scaleY = echelle
                transformOrigin = TransformOrigin(0.5f, 0f)
            }
        }
    }
}

/** Carte qui vient de quitter l'écran : trouvée, elle s'envole en or ; passée, elle file sur le côté. */
private class Sortie(val carte: MimeCard, val trouvee: Boolean)

/**
 * La carte : elle surgit en tournant légèrement à chaque nouveau mot, pendant que la précédente s'envole
 * (trouvée) ou file à gauche (passée). Un tampon « TROUVÉ ! » et une gerbe de confettis saluent chaque mime.
 */
@Composable
private fun MimeCardView(m: MimeUi, color: Color, photos: Map<String, ByteArray>) {
    val card = m.card
    // Changement de joueur (roulement, cedric 24/10) : pas d'image, la face « Changement de joueur ! » à sa place.
    if (card == null && m.relais == null) return
    val cle = Triple(card?.word, m.found, m.passed)
    val pop = remember(cle) { Animatable(0.6f) }
    LaunchedEffect(cle) {
        pop.snapTo(0.6f)
        pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium))
    }
    var vue by remember { mutableStateOf(Triple(card, m.found, m.passed)) }
    var sortie by remember { mutableStateOf<Sortie?>(null) }
    val depart = remember { Animatable(1f) }
    LaunchedEffect(cle) {
        val (ancienne, trouves, passes) = vue
        vue = Triple(card, m.found, m.passed)
        if (ancienne != null && (m.found > trouves || m.passed > passes)) {
            sortie = Sortie(ancienne, trouvee = m.found > trouves)
            depart.snapTo(0f)
            depart.animateTo(1f, tween(550, easing = FastOutSlowInEasing))
            sortie = null
        }
    }
    Box(contentAlignment = Alignment.Center) {
        sortie?.let { s ->
            MimeCardFace(
                s.carte, if (s.trouvee) Neon.Or else color, s.carte.imageId?.let { photos[it] },
                Modifier.clearAndSetSemantics {}.graphicsLayer {
                    val v = depart.value
                    alpha = 1f - v
                    if (s.trouvee) {
                        translationY = -260f * v
                        scaleX = 1f + 0.15f * v
                        scaleY = 1f + 0.15f * v
                    } else {
                        translationX = -760f * v
                        rotationZ = -14f * v
                    }
                },
            )
        }
        val entree = Modifier.graphicsLayer { scaleX = pop.value; scaleY = pop.value; rotationZ = (1f - pop.value) * -12f }
        if (card != null) MimeCardFace(card, color, card.imageId?.let { photos[it] }, entree)
        else RelaisFace(color, cle = m.found to m.passed, modifier = entree)
        Gerbe(cle = m.found, actif = m.found > 0, modifier = Modifier.matchParentSize())
        // Roulement : le tampon laisse vite la place au « On tourne ! ».
        Tampon("TROUVÉ !", cle = m.found, actif = m.found > 0, tailleSp = 56, dureeMs = Tempo.MIME_RELAIS.toInt() + 50, modifier = Modifier.matchParentSize())
        // « ⏭ Passer » (cedric, 26/10) : le mimeur abandonne, les joueurs tournent aussi.
        Tampon("PASSÉ !", cle = m.passed, couleur = Neon.Halo, actif = m.passed > 0 && m.relais != null, tailleSp = 56, dureeMs = Tempo.MIME_RELAIS.toInt() + 50, modifier = Modifier.matchParentSize())
    }
}

/**
 * Mimes en file (cedric, 24/10 puis 26/10) : le mime est trouvé ou passé, le mimeur file au bout de la queue et le
 * suivant court face à l'écran. Après « TROUVÉ ! » ou « PASSÉ ! », « ON TOURNE ! » claque une seconde, puis la carte
 * reste retournée, sans image, jusqu'à ce que Sarah montre l'image suivante : flèches qui tournent et rappel de la
 * place de chacun. Même taille que la carte : rien ne saute à l'écran.
 */
@Composable
private fun RelaisFace(color: Color, cle: Any?, modifier: Modifier) {
    // 0 : « TROUVÉ ! » ou « PASSÉ ! » ; 1 : « On tourne ! » ; 2 : on attend que chacun soit à sa place.
    var etape by remember(cle) { mutableStateOf(0) }
    LaunchedEffect(cle) {
        delay(Tempo.MIME_RELAIS)
        etape = 1
        delay(Tempo.MIME_RELAIS_DUREE)
        etape = 2
    }
    val coup = remember(cle) { Animatable(0f) }
    LaunchedEffect(cle, etape) {
        if (etape != 1) return@LaunchedEffect
        coup.snapTo(0f)
        coup.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow))
    }
    val boucle = rememberInfiniteTransition(label = "relais")
    val respire by boucle.animateFloat(0.55f, 1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "respire")
    val tour by boucle.animateFloat(0f, 360f, infiniteRepeatable(tween(2_400, easing = LinearEasing)), label = "tour")
    Box(
        modifier
            .width(500.dp)
            .height(300.dp)
            .clip(RoundedCornerShape(36.dp))
            .background(Brush.verticalGradient(listOf(color.copy(alpha = 0.40f), Neon.Nuit2.copy(alpha = 0.9f), Neon.Nuit.copy(alpha = 0.95f))))
            .border(4.dp, color.copy(alpha = if (etape == 2) respire else 1f), RoundedCornerShape(36.dp))
            .padding(horizontal = 24.dp, vertical = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (etape == 1) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.graphicsLayer {
                    val v = coup.value
                    scaleX = 0.4f + 0.6f * v
                    scaleY = 0.4f + 0.6f * v
                    rotationZ = -6f * (1f - v)
                    alpha = v.coerceIn(0f, 1f)
                },
            ) {
                Text("🔄", fontSize = 64.sp, lineHeight = 70.sp)
                Text(
                    "ON TOURNE !",
                    textAlign = TextAlign.Center, maxLines = 1,
                    style = TextStyle(
                        fontFamily = PoliceLmp, brush = Brush.verticalGradient(listOf(Neon.OrClair, Neon.Or, Neon.OrProfond)),
                        fontSize = 46.sp, lineHeight = 50.sp, fontWeight = FontWeight.Black, letterSpacing = 2.sp,
                        shadow = Shadow(color.copy(alpha = 0.9f), Offset.Zero, 26f),
                    ),
                )
            }
        } else if (etape == 2) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("🔄", fontSize = 76.sp, lineHeight = 84.sp, modifier = Modifier.graphicsLayer { rotationZ = tour }.scale(0.92f + 0.08f * respire))
                Text(
                    "Au mimeur suivant !", color = Neon.Blanc, fontSize = 38.sp, lineHeight = 42.sp, fontWeight = FontWeight.Black,
                    textAlign = TextAlign.Center, maxLines = 1,
                )
                Text(
                    "Le mimeur face à l'écran !", color = Palette.InkSoft, fontSize = 22.sp, lineHeight = 26.sp, fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center, maxLines = 1,
                )
            }
        }
    }
}

/** Face de la carte : verre sombre, liseré néon de la couleur de l'équipe, reflet de cette couleur en haut. */
@Composable
private fun MimeCardFace(card: MimeCard, color: Color, octets: ByteArray?, modifier: Modifier) {
    // « 📷 Photos » : la photo du mot à la place de l'émoji (qui revient si la photo n'est pas arrivée).
    val photo = photoCarte(octets, PHOTO_CARTE_MIMES)
    Column(
        modifier
            .width(500.dp)
            .clip(RoundedCornerShape(36.dp))
            .background(Brush.verticalGradient(listOf(color.copy(alpha = 0.30f), Neon.Nuit2.copy(alpha = 0.85f), Neon.Nuit.copy(alpha = 0.9f))))
            .border(4.dp, color, RoundedCornerShape(36.dp))
            .padding(vertical = 12.dp, horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (photo != null) {
            // La photo entière, plus grande, à ses proportions : rien de coupé (cedric, 27/10 au soir : le flamant
            // rose avait la tête coupée par le cadrage au milieu).
            val (l, h) = photoDansTuile(320f, 220f, photo.width.toFloat(), photo.height.toFloat())
            Image(
                photo, contentDescription = null, contentScale = ContentScale.FillBounds,
                modifier = Modifier.padding(top = 4.dp, bottom = 6.dp).size(width = l.dp, height = h.dp)
                    .clip(RoundedCornerShape(20.dp)).border(2.dp, Neon.Blanc.copy(alpha = 0.7f), RoundedCornerShape(20.dp)),
            )
        } else {
            Text(card.image ?: "🎭", fontSize = 120.sp, lineHeight = 128.sp, textAlign = TextAlign.Center)
        }
        Text(
            card.word, color = Neon.Blanc, fontSize = 42.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
            maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 46.sp,
        )
    }
}

/** Place du compteur à droite de la carte : assez pour « 88 » en 96 sp et « trouvés ». */
private val COMPTEUR_LARGEUR = 200.dp

/** Compteur du tour : il rebondit et lâche un « +1 » doré à chaque mime trouvé. */
@Composable
private fun FoundCounter(found: Int) {
    val bump = remember { Animatable(1f) }
    val flyer = remember { Animatable(0f) }
    LaunchedEffect(found) {
        if (found == 0) return@LaunchedEffect
        bump.snapTo(1.5f)
        flyer.snapTo(1f)
        bump.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy))
    }
    LaunchedEffect(found) { if (found > 0) flyer.animateTo(0f, tween(900)) }
    // Largeur fixe et interligne serré (cedric 24/10, photo : chiffre très au-dessus de « trouvés », bloc collé à la
    // carte) : le chiffre et son mot restent un seul bloc centré, quelle que soit la largeur du nombre.
    Box(Modifier.width(COMPTEUR_LARGEUR), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "$found", color = Neon.Or, fontSize = 96.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                style = TextStyle(lineHeight = 96.sp, lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.Both)),
                modifier = Modifier.scale(bump.value),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                if (found > 1) "trouvés" else "trouvé", color = Palette.InkSoft, fontSize = 24.sp, fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center, maxLines = 1, softWrap = false,
            )
        }
        Text(
            "+1", color = Neon.Or, fontSize = 44.sp, fontWeight = FontWeight.Black,
            modifier = Modifier.alpha(flyer.value).graphicsLayer { translationY = -140f * (1f - flyer.value) },
        )
    }
}

/**
 * Côté du masque des mimes entre deux tours, en dp, pour [hauteur] dp de place : 220 au plus. Il ne prend jamais la
 * place des textes (cedric, 30/10 : avec 8 équipes, la règle était coupée) ; sous [MASQUE_MIN] dp, il disparaît (0).
 */
internal fun tailleMasqueMimes(hauteur: Float): Float =
    (hauteur - TEXTES_ENTRE_TOURS).coerceAtMost(220f).let { if (it < MASQUE_MIN) 0f else it }

/** Plus petit masque montré entre deux tours (dp) : en dessous, il ne se lit plus, les textes restent seuls. */
private const val MASQUE_MIN = 72f

/**
 * Nom du paquet à côté de la pastille « MIMES », ou null quand il la répète (cedric, 30/10 : « Mimes » écrit deux
 * fois) : seule la pastille reste.
 */
internal fun sousTitreMimes(texte: String?): String? {
    val t = texte?.trim().orEmpty()
    val simple = java.text.Normalizer.normalize(t, java.text.Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").lowercase()
    return t.takeIf { it.isNotEmpty() && simple !in setOf("mimes", "mime", "les mimes", "les mimes !") }
}

/** Place des textes sous le masque : bravo sur 2 lignes (nom long), points, consigne sur 3 lignes et espaces (dp). */
private const val TEXTES_ENTRE_TOURS = 250f

/** Entre deux tours : bilan du tour qui vient de finir, puis qui va mimer. */
@Composable
private fun BetweenTurns(state: UiState.Playing, m: MimeUi, modifier: Modifier) {
    val last = m.last
    val lastTeam = state.teams.find { it.uid == last?.team }
    // Le bilan d'un tour arrive après le tampon « TEMPS ÉCOULÉ ! » ; l'ouverture de la manche, tout de suite.
    val bilan = if (last != null) Tempo.MIME_BILAN else 0L
    BoxWithConstraints(modifier.fillMaxWidth()) {
        if (last != null && last.found > 0) Gerbe(cle = m.turns.size, actif = apres(bilan, m.turns.size))
        // Le masque des mimes en grand (cedric, 27/10 au soir : Sarah l'aime bien, « juste un peu plus gros »), sans
        // jamais pousser le bravo, les points ni la consigne hors de l'écran.
        val masque = tailleMasqueMimes(maxHeight.value).dp
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            // Game Show : le logo néon des mimes (planche du 24/10) à la place de l'émoji.
            val logo = if (Look.gs) logoNeonJeu("mimes") else null
            if (masque.value == 0f) Unit
            else if (logo != null) Image(painterResource(logo), contentDescription = null, modifier = Modifier.size(masque).apparition(bilan, m.turns.size))
            else {
                val taille = with(LocalDensity.current) { (masque * 0.62f).toSp() }
                Text("🎭", fontSize = taille, lineHeight = taille * 1.07f, modifier = Modifier.apparition(bilan, m.turns.size))
            }
            // Game Show : plus de bande sombre, le bravo et la règle sont posés sur le décor « comme les jauges » (n° 14 du
            // 31/10). Le titre « Les Mimes ! » ne bouge pas.
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            if (last != null && lastTeam != null) {
                TexteJauge(
                    if (last.found > 0) "Bravo ${lastTeam.name} !" else "Bien essayé ${lastTeam.name} !",
                    color = lastTeam.color.toColor(), fontSize = 44.sp, lineHeight = 50.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                    modifier = Modifier.apparition(bilan, m.turns.size).rebond(apres(bilan, m.turns.size)),
                )
                TexteJauge(
                    "${last.found} mime${if (last.found > 1) "s" else ""} trouvé${if (last.found > 1) "s" else ""} · +${last.found * Scoring.MIME} points",
                    color = Neon.Or, fontSize = 32.sp, lineHeight = 38.sp, fontWeight = FontWeight.Black,
                    modifier = Modifier.apparition(bilan + Tempo.TEMPS, m.turns.size),
                )
            } else {
                Text(
                    "Les Mimes !",
                    maxLines = 1, softWrap = false,
                    style = TextStyle(
                        fontFamily = PoliceLmp, brush = Brush.verticalGradient(listOf(Neon.OrClair, Neon.Or, Neon.OrProfond)),
                        fontSize = 56.sp, lineHeight = 62.sp, fontWeight = FontWeight.Black, letterSpacing = 2.sp,
                        shadow = Shadow(Neon.Halo.copy(alpha = 0.7f), Offset.Zero, 30f),
                    ),
                    modifier = Modifier.apparition(0, Unit).rebond(true),
                )
            }
            Spacer(Modifier.height(10.dp))
            TexteJauge(
                when {
                    // Mimes en file (cedric, 26/10) : une couleur par manche, le bilan des scores suit tout seul.
                    state.question?.couleur != null && m.turns.isNotEmpty() -> "Place au classement !"
                    state.question?.couleur != null -> "Tous en file : le mimeur face à l'écran, les autres dos à l'écran.\nChaque mime trouvé rapporte ${Scoring.MIME} points."
                    m.turns.isEmpty() -> "Celui qui devine se met dos à la TV, ses coéquipiers miment sans parler.\nChaque mime trouvé rapporte ${Scoring.MIME} points."
                    remainingTeams(state, m).isEmpty() -> "Toutes les équipes sont passées !"
                    else -> "Prochaine équipe : ${remainingTeams(state, m).first().name}\nRestent : ${remainingTeams(state, m).joinToString(", ") { it.name }}"
                },
                color = Palette.Ink, fontSize = 24.sp, textAlign = TextAlign.Center, lineHeight = 32.sp,
                maxLines = 3, overflow = TextOverflow.Ellipsis,
            )
            }
        }
    }
}

@Composable
private fun MimeTeamChip(team: Team, count: Int, playing: Boolean, passed: Boolean, compacte: Boolean = false, modifier: Modifier = Modifier) {
    val color = team.color.toColor()
    val taille = if (compacte) 14.sp else 16.sp
    // Game Show : la plaque noire au contour néon du Pictionary (cedric, 30/10 : sur le décor, les cartes se lisaient
    // mal). L'équipe qui joue : sa couleur en fond, contour plus épais.
    val forme = RoundedCornerShape(16.dp)
    Column(
        modifier
            .then(if (Look.gs) Modifier.shadow(10.dp, forme, ambientColor = color, spotColor = color) else Modifier)
            .clip(forme)
            .background(
                when {
                    playing -> color.copy(alpha = 0.45f)
                    Look.gs -> Neon.Nuit.copy(alpha = 0.88f)
                    else -> Palette.Panel
                },
            )
            .border(if (playing || Look.gs) 3.dp else 2.dp, color, forme)
            .padding(horizontal = if (compacte) 8.dp else 12.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(team.name, color = Palette.Ink, fontSize = taille, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
            "$count mime${if (count > 1) "s" else ""}" + if (passed && !playing) " ✓" else "",
            color = when {
                Look.gs && !playing -> color
                count > 0 -> Neon.Or
                else -> Palette.InkSoft
            },
            fontSize = taille, fontWeight = FontWeight.Bold,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Équipes qui ne sont pas encore passées dans cette manche de mimes, dans l'ordre d'inscription. */
private fun remainingTeams(state: UiState.Playing, m: MimeUi): List<Team> = state.teams.filter { it.uid !in m.turns }

/**
 * Secours à la télécommande : « Trouvé » a le focus pendant un tour, « Image suivante » pendant le changement de joueur,
 * « Top départ » entre deux tours.
 */
@Composable
private fun MimeButtons(state: UiState.Playing, m: MimeUi, actions: TvActions) {
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
        val enFile = state.question?.couleur != null
        if (m.team != null && m.relais != null) {
            // On tourne : chacun est à sa place, on montre l'image suivante.
            TvButton("Arrêter le tour", actions.mimeStop, fontSize = 20.sp)
            NextButton("Image suivante", actions.mimePass, key = "relais-${m.turns.size}-${m.found}-${m.passed}")
        } else if (m.team != null) {
            // Mimes en file : « Passer » fait tourner les joueurs, comme un mime trouvé.
            if (enFile) TvButton("Passer", actions.mimeSkip, fontSize = 20.sp) else TvButton("Image suivante", actions.mimePass, fontSize = 20.sp)
            TvButton("Arrêter le tour", actions.mimeStop, fontSize = 20.sp)
            NextButton("Trouvé !", actions.mimeFound, key = "turn-${m.turns.size}")
        } else if (enFile) {
            // Une manche par couleur : l'équipe de la couleur joue, puis le bilan des scores arrive tout seul.
            val equipe = state.teams.firstOrNull { it.color.equals(state.question?.couleur, ignoreCase = true) }
            if (m.turns.isEmpty() && equipe != null) NextButton("Top départ : ${equipe.name}", { actions.mimeStart(equipe.uid) }, key = "between-0")
            else NextButton("Voir le classement", actions.next, key = "between-${m.turns.size}")
        } else {
            // Chaque équipe passe à son tour ; quand toutes sont passées, le bouton principal mène au classement.
            val next = remainingTeams(state, m).firstOrNull()
            if (next != null) {
                TvButton("Terminer les mimes", actions.next, fontSize = 20.sp)
                NextButton("Top départ : ${next.name}", { actions.mimeStart(next.uid) }, key = "between-${m.turns.size}")
            } else {
                val again = state.teams.minByOrNull { t -> m.turns.count { it == t.uid } }
                if (again != null) TvButton("Encore un tour : ${again.name}", { actions.mimeStart(again.uid) }, fontSize = 20.sp)
                NextButton(versClassement(state, "Voir le classement"), actions.next, key = "between-${m.turns.size}")
            }
        }
    }
}

/** Chrono du tour, calé sur l'heure du serveur comme celui des questions. */
@Composable
internal fun MimeCountdown(state: UiState.Playing) {
    val total = state.question?.durationMs ?: 1
    var remaining by remember { mutableLongStateOf(state.remainingMs) }
    LaunchedEffect(state.deadline, state.paused) {
        val deadline = state.deadline
        if (deadline == null) {
            remaining = state.remainingMs
            return@LaunchedEffect
        }
        val start = state.resumeAt ?: 0L
        while (true) {
            remaining = (deadline - maxOf(System.currentTimeMillis() + state.serverOffset, start)).coerceAtLeast(0)
            if (remaining == 0L) break
            delay(100)
        }
    }
    val seconds = ((remaining + 999) / 1000).toInt()
    val urgent = seconds <= 10
    val fraction = remaining.toFloat() / total
    // Dix dernières secondes : le chrono bat à chaque seconde, comme la tension sonore.
    val battement = remember { Animatable(1f) }
    LaunchedEffect(seconds) {
        if (!urgent || seconds == 0) return@LaunchedEffect
        battement.snapTo(1.18f)
        battement.animateTo(1f, tween(400))
    }
    Box(
        Modifier.size(84.dp).graphicsLayer { scaleX = battement.value; scaleY = battement.value }.drawBehind {
            val stroke = 9.dp.toPx()
            val box = Size(size.width - stroke, size.height - stroke)
            drawArc(Color.White.copy(alpha = 0.2f), 0f, 360f, false, style = Stroke(stroke), topLeft = Offset(stroke / 2, stroke / 2), size = box)
            drawArc(if (urgent) Neon.Chaud else Neon.Or, -90f, 360f * fraction, false, style = Stroke(stroke), topLeft = Offset(stroke / 2, stroke / 2), size = box)
        },
        contentAlignment = Alignment.Center,
    ) {
        Text("$seconds", style = styleCentre(34.sp, if (urgent) Neon.Chaud else Palette.Ink, FontWeight.Black))
    }
}

/** Halo de la couleur de l'équipe : dessiné une fois, seule son opacité respire (léger pour la box). */
@Composable
private fun TeamGlow(color: Color) {
    val pulse by rememberInfiniteTransition(label = "glow").animateFloat(
        0.55f, 1f, infiniteRepeatable(tween(1400), RepeatMode.Reverse), label = "pulse",
    )
    Box(
        Modifier.fillMaxSize().graphicsLayer { alpha = pulse }.drawWithCache {
            val r = size.minDimension * 0.75f
            val halo = Brush.radialGradient(listOf(color.copy(alpha = 0.45f), Color.Transparent), center = Offset(size.width / 2, size.height / 2), radius = r)
            onDrawBehind { drawCircle(halo, radius = r) }
        },
    )
}
