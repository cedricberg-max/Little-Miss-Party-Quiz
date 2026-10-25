package com.littlemissparty.quiz.tv

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.littlemissparty.quiz.engine.BlindStatus
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.tv.habillage.MotsNeon
import com.littlemissparty.quiz.tv.habillage.Look
import com.littlemissparty.quiz.tv.habillage.selonLook
import com.littlemissparty.quiz.tv.habillage.ANNONCE_MULTIPLICATEUR_MS
import com.littlemissparty.quiz.tv.habillage.AnnonceMultiplicateur
import com.littlemissparty.quiz.tv.habillage.BandeauEquipes
import com.littlemissparty.quiz.tv.habillage.Classee
import com.littlemissparty.quiz.tv.habillage.Couronne
import com.littlemissparty.quiz.tv.habillage.LaParole
import com.littlemissparty.quiz.tv.habillage.PAROLE_CENTRE_MS
import com.littlemissparty.quiz.tv.habillage.PAROLE_GLISSE_MS
import com.littlemissparty.quiz.tv.habillage.QuestionPanneau3d
import com.littlemissparty.quiz.tv.habillage.planchesQuiz3d
import com.littlemissparty.quiz.tv.habillage.Neon
import com.littlemissparty.quiz.tv.habillage.LogoLmp
import com.littlemissparty.quiz.tv.habillage.Victoire
import com.littlemissparty.quiz.tv.habillage.Tempo
import com.littlemissparty.quiz.tv.habillage.apparition
import com.littlemissparty.quiz.tv.habillage.apres
import com.littlemissparty.quiz.tv.habillage.rebond
import com.littlemissparty.quiz.tv.habillage.reflet
import com.littlemissparty.quiz.tv.habillage.styleCentre
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

/** Question, question fermée et révélation : le même plateau, qui évolue. */
@Composable
fun QuestionScreen(state: UiState.Playing, actions: TvActions) {
    val q = state.question ?: return
    val revealed = state.phase == Phase.REVEAL
    // Blind test ou quiz musical : l'extrait joue depuis le cache de la box, calé sur le chrono.
    ExtraitMusical(q, state)
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 24.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (Look.gs) EtapeGs(state.etape ?: "Question ${state.index + 1}", Modifier.weight(1f, fill = false))
                else Text(
                    state.etape ?: "Question ${state.index + 1}",
                    color = Palette.InkSoft, fontSize = 22.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                )
                if (q.isExpress) {
                    Spacer(Modifier.width(16.dp))
                    Text(
                        "VRAI OU FAUX EXPRESS",
                        color = Palette.Night, fontSize = 18.sp, fontWeight = FontWeight.Black,
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(Palette.Ink).padding(horizontal = 14.dp, vertical = 4.dp),
                    )
                }
                if (q.double) {
                    Spacer(Modifier.width(16.dp))
                    Text(
                        "POINTS ×${state.factor.coerceAtLeast(2)}",
                        color = Palette.Night, fontSize = 18.sp, fontWeight = FontWeight.Black,
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(Palette.Gold).padding(horizontal = 14.dp, vertical = 4.dp),
                    )
                }
                Spacer(Modifier.width(20.dp))
                Spacer(Modifier.weight(1f))
                when (state.phase) {
                    Phase.QUESTION -> Countdown(state)
                    Phase.CLOSED -> Text(
                        if (state.answered.size >= state.teams.size && state.teams.isNotEmpty()) "Toutes les équipes ont répondu !" else "Temps écoulé !",
                        color = Palette.Gold, fontSize = 26.sp, fontWeight = FontWeight.Black,
                    )
                    else -> {}
                }
            }
            Spacer(Modifier.height(12.dp))
            // Blind test : pas de question écrite (« Quel est ce titre ? »), la scène prend la place.
            // Statues : le panneau porte déjà l'étiquette « STATUES MUSICALES », le titre en double lui volerait sa place.
            // Chante le mot en Game Show : le mot est déjà sur l'enseigne néon, en double il lui volerait sa hauteur.
            if (!q.isBlind && !q.isStatues && !(Look.gs && q.isChante)) {
                // Game Show 3D : la question dans son enseigne néon (hors jeux au buzzer, qui ont leur propre scène).
                val panneau = planchesQuiz3d()?.takeIf { !q.isBuzz }
                if (panneau != null) QuestionPanneau3d(panneau, q.text, Modifier.fillMaxWidth().apparition(0, state.index), festif = q.isMusical)
                else if (Look.gs && q.isMusical && q.text.length <= 24) MotsNeon(q.text, 40.sp, Modifier.apparition(0, state.index))
                else Text(
                    q.text,
                    color = Palette.Ink, fontSize = selonLook(34.sp, 38.sp), fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                    lineHeight = selonLook(40.sp, 42.sp), maxLines = 3, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth().apparition(0, state.index),
                )
                Spacer(Modifier.height(if (panneau != null) 14.dp else 20.dp))
            }
            // Chaque question a ses propres cartes : elles surgissent une à une, sur les bulles sonores.
            key(state.index) {
                // Quiz musical (cedric, 24/10) : la bonne réponse s'allume, puis la révélation du blind test en plus court.
                // Sinon, à la révélation, l'illustration facultative (photo ou émoji) apparaît à gauche des propositions.
                if (revealed && q.isMusical && apres(MUSICAL_GRILLE_MS, q.id)) {
                    RevelationMusicale(q, state, Modifier.weight(1f).fillMaxWidth())
                } else Row(Modifier.weight(1f)) {
                    // Zoom mystère : la photo est la question, elle se dévoile pendant tout le chrono.
                    if (q.isFlou) {
                        // Image floue : la photo est la question, réponse à voix haute après un buzz.
                        FlouPhoto(q, state, Modifier.fillMaxHeight().aspectRatio(4f / 3f, matchHeightConstraintsFirst = true))
                        Spacer(Modifier.width(20.dp))
                    } else if (q.isChante) {
                        ChanteBoard(q, state, Modifier.weight(1.4f).fillMaxHeight())
                        Spacer(Modifier.width(20.dp))
                    } else if (q.isBlind) {
                        // Blind test : une scène par moment (présentation, écoute, « STOP ! », révélation) sur toute la largeur.
                        BlindScene(q, state, Modifier.weight(1f).fillMaxHeight())
                    } else if (q.isDisparu) {
                        DisparuBoard(q, state, Modifier.weight(1.6f).fillMaxHeight())
                        Spacer(Modifier.width(20.dp))
                    } else if (q.isQuiSuis) {
                        QuiSuisBoard(q, state, Modifier.weight(1.4f).fillMaxHeight())
                        Spacer(Modifier.width(20.dp))
                    } else if (q.isZoom) {
                        ZoomPhoto(q, state, Modifier.fillMaxHeight().aspectRatio(4f / 3f, matchHeightConstraintsFirst = true))
                        Spacer(Modifier.width(20.dp))
                    } else if (revealed && !q.isMusical && hasIllustration(q, state)) {
                        val photo = q.imageId != null && state.images[q.imageId] != null
                        Illustration(q, state, Modifier.fillMaxHeight().aspectRatio(if (photo) 4f / 3f else 1f, matchHeightConstraintsFirst = true))
                        Spacer(Modifier.width(20.dp))
                    }
                    // Le blind test occupe déjà toute la largeur.
                    if (q.isStatues) StatuesBoard(q, state, Modifier.weight(1f).fillMaxHeight())
                    else if (q.isBlind) {}
                    else if (q.isBuzz) FlouPanel(q, state, Modifier.weight(1f).fillMaxHeight())
                    else if (q.isNumber) NumberBoard(state, revealed, Modifier.weight(1f).fillMaxHeight())
                    else {
                        val photos = q.choiceImages.map { id -> id?.let { state.images[it] } }
                        ChoiceGrid(
                            q.choices, correct = if (revealed) q.correct else null, Modifier.weight(1f).fillMaxHeight(), express = q.isExpress,
                            photos = photos,
                            // Illustration à gauche : les réponses en texte passent sur une seule colonne, assez large pour
                            // « Le guépard » sans le couper en deux (banc d'essai du 20 octobre).
                            uneColonne = revealed && !q.isMusical && hasIllustration(q, state) && photos.all { it == null },
                        )
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            // De 1 à 8 équipes : les pastilles passent au-dessus des boutons quand elles ne tiennent plus à côté.
            val gagnants = state.teams.filter { (state.awards[it.uid]?.points ?: 0) > 0 }
            val pastillesBasses = Look.gs && state.teams.size > 4
            // Statues : pendant la danse et jusqu'au choix de l'animatrice, les pastilles ne disent rien (personne ne répond
            // au pupitre) ; seuls les boutons restent, et « DANSEZ ! » garde sa place même à 8 équipes (banc du 20 octobre).
            BandeauEquipes(
                nombre = if (q.isStatues && !revealed) 0 else state.teams.size,
                modifier = Modifier.fillMaxWidth(),
                // Game Show, 5 équipes et plus : pastilles basses sur deux rangs à côté des boutons.
                largeurConfort = if (pastillesBasses) 130.dp else 150.dp,
                actions = { BoutonsQuestion(state, q, actions) },
            ) { i, compacte, m ->
                val team = state.teams.getOrNull(i) ?: return@BandeauEquipes
                TeamStatus(
                    rangGagnant = gagnants.indexOf(team),
                    team = team,
                    online = team.uid in state.online,
                    answered = team.uid in state.answered,
                    points = if (revealed) state.awards[team.uid]?.points ?: 0 else null,
                    choice = if (revealed) state.awards[team.uid]?.choice else null,
                    isNumber = q.isNumber,
                    express = q.isExpress,
                    compacte = compacte,
                    uneLigne = pastillesBasses,
                    modifier = m,
                )
            }
        }
        // Blind test : annonce des derniers morceaux à double valeur, par-dessus tout l'écran.
        if (q.isBlind) BlindAnnonceDouble(q, state)
        // Dernières questions du quiz à points multipliés : « × N » en plein écran avant que le chrono parte.
        state.introUntil?.let { fin -> key(fin) { AnnonceFacteur(state, fin) } }
        // Jeux au buzzer : « La parole est à … » en grand, puis en bandeau tant que l'équipe répond
        // (le blind test a sa propre scène au buzz).
        if (q.isBuzz && !q.isBlind) key(state.index) { AnnonceParole(state) }
    }
}

/**
 * L'équipe qui a buzzé, par-dessus la question. Le nom reste le temps de la sortie après le verdict ; une box qui
 * arrive sur une question déjà buzzée (reconnexion) affiche directement le bandeau, sans rejouer l'annonce au centre.
 */
@Composable
private fun AnnonceParole(state: UiState.Playing) {
    val buzzer = state.teams.find { it.uid == state.buzzTeam }
    val dejaLa = remember { state.buzzTeam }
    val dernier = remember { arrayOf(buzzer) }
    if (buzzer != null) dernier[0] = buzzer
    val equipe = dernier[0] ?: return
    LaParole(
        nom = equipe.name,
        couleur = equipe.color.toColor(),
        visible = buzzer != null && state.phase == Phase.QUESTION && !state.paused,
        dejaMs = if (equipe.uid == dejaLa) PAROLE_CENTRE_MS + PAROLE_GLISSE_MS else 0L,
    )
}

/** Annonce « × N » jusqu'au départ du chrono (calé sur l'heure du serveur, comme le décompte d'une reprise). */
@Composable
private fun AnnonceFacteur(state: UiState.Playing, fin: Long) {
    val reste = remember(fin) { (fin - (System.currentTimeMillis() + state.serverOffset)).coerceIn(0L, ANNONCE_MULTIPLICATEUR_MS) }
    if (reste > 0 && !apres(reste, fin) && !state.paused) {
        AnnonceMultiplicateur(
            facteur = state.factor.coerceAtLeast(2), restantes = state.multipliedLeft.coerceAtLeast(1),
            affirmations = state.question?.isExpress == true,
        )
    }
}

/** Boutons de l'animatrice sous la question. En pause, le seul bouton est « Reprendre » sur l'intermède. */
@Composable
private fun BoutonsQuestion(state: UiState.Playing, q: Question, actions: TvActions) {
    if (!state.paused) when (state.phase) {
        // Jeux au buzzer : l'animatrice juge la réponse orale. Régie reliée : elle juge depuis la régie,
        // la TV ne montre pas de boutons de secours (la télécommande reprend la main sans régie).
        Phase.QUESTION -> if (q.isBuzz && state.buzzTeam != null) {
            if (state.regies == 0) Row(horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                TvButton("Mauvaise réponse", { actions.judgeBuzz(false) }, fontSize = 24.sp)
                NextButton("Bonne réponse", { actions.judgeBuzz(true) }, key = state.buzzTeam)
            }
        } else if (q.isBlind && state.blind != null && state.blind.waiting) {
            // Blind test, musique à l'arrêt : l'animatrice lance (ou relance), révèle ou passe le morceau. Régie reliée :
            // révéler et passer se font depuis la régie. Écart large : le bouton sélectionné grossit et brille.
            Row(horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                if (state.regies == 0) {
                    TvButton("Passer", actions.blindSkip, fontSize = 24.sp)
                    TvButton("Révéler sans points", actions.blindReveal, fontSize = 24.sp)
                }
                NextButton(if (state.blind.played) "Relancer la musique" else "Lancer le morceau", actions.next, key = state.blind.played)
            }
        } else NextButton(if (q.isBlind) "Arrêter la musique" else "Arrêter le chrono", actions.next, key = state.phase)
        Phase.CLOSED -> NextButton("Révéler la réponse", actions.next, key = state.phase)
        // Vrai ou Faux express : la TV enchaîne seule ; le bouton ne fait qu'aller plus vite.
        else -> NextButton(
            when {
                q.isExpress -> "Suivant"
                // Blind test : le morceau suivant s'annonce, sans démarrer ; après le dernier, le bilan.
                q.isBlind -> state.blind?.takeIf { it.numero < it.total }?.let { "Titre suivant" } ?: "Bilan du blind test"
                else -> "Voir les scores"
            },
            actions.next, key = state.phase,
        )
    }
}

@Composable
private fun ChoiceGrid(
    choices: List<String>, correct: Int?, modifier: Modifier, express: Boolean = false, photos: List<ByteArray?> = emptyList(),
    uneColonne: Boolean = false,
) {
    BoxWithConstraints(modifier) {
        if (photos.any { it != null }) {
            GrilleImages(choices, correct, photos, express, maxWidth, maxHeight)
            return@BoxWithConstraints
        }
        // Une colonne seulement si les 4 cartes y gardent une hauteur lisible. À 8 équipes, le bandeau prend deux rangs :
        // l'illustration devient petite et il reste la place de 2 × 2 à côté (banc d'essai du 20 octobre).
        val colonne = uneColonne && maxHeight >= 46.dp * 4 + 10.dp * 3
        val ecart = if (colonne) 10.dp else 14.dp
        // Cartes basses (colonne, ou 2 × 2 serré à 8 équipes) : pastille et texte plus petits pour tenir.
        val compacte = colonne || (maxHeight - ecart) / 2 < 64.dp
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(ecart)) {
            choices.indices.chunked(if (colonne) 1 else 2).forEach { row ->
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    row.forEach { i ->
                        ChoiceCard(
                            i, choices[i], correct, Modifier.weight(1f).fillMaxHeight().apparition(Tempo.propositionApparait(i), Unit), express, photos.getOrNull(i),
                            compacte = compacte,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Quiz illustré : les réponses en images, aussi grandes que la place le permet (retour de cedric le 21/10 : petites
 * vignettes perdues au milieu de grandes cartes, lettre collée sur l'image). On compare quatre dispositions — une
 * rangée de cartes ou une grille 2 × 2, image au-dessus du mot ou à côté — et on garde celle où l'image est la plus
 * grande. La lettre et le mot restent hors de l'image, sous elle ou à côté.
 */
@Composable
private fun GrilleImages(choices: List<String>, correct: Int?, photos: List<ByteArray?>, express: Boolean, largeur: Dp, hauteur: Dp) {
    val n = choices.size.coerceAtLeast(1)
    val ecart = 14.dp
    val marge = 8.dp
    val etiquette = 40.dp
    fun cote(colonnes: Int, rangs: Int, dessus: Boolean): Dp {
        val cw = (largeur - ecart * (colonnes - 1)) / colonnes
        val ch = (hauteur - ecart * (rangs - 1)) / rangs
        return if (dessus) minOf(cw - marge * 2, ch - etiquette - marge * 3) else minOf(ch - marge * 2, cw * 0.42f)
    }
    val dispositions = buildList {
        add(Triple(n, 1, true)); add(Triple(n, 1, false))
        if (n == 4) { add(Triple(2, 2, true)); add(Triple(2, 2, false)) }
    }
    val (colonnes, _, dessus) = dispositions.maxBy { (c, r, d) -> cote(c, r, d) }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(ecart)) {
        choices.indices.chunked(colonnes).forEach { rang ->
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(ecart)) {
                rang.forEach { i ->
                    ChoiceCard(
                        i, choices[i], correct, Modifier.weight(1f).fillMaxHeight().apparition(Tempo.propositionApparait(i), Unit), express,
                        photos.getOrNull(i), imageDessus = dessus, tous = choices,
                    )
                }
            }
        }
    }
}

/**
 * Le mot d'une réponse en image, sur une seule ligne : on part de [max] et on réduit jusqu'à ce qu'il tienne en
 * entier dans la place qui reste (jamais coupé au milieu, règle « texte jamais coupé »). Les quatre réponses gardent
 * la même taille quand c'est possible ; une réponse bien plus longue que les autres (« Camion de pompiers ») se
 * réduit seule plutôt que de rapetisser toutes les autres.
 */
@Composable
private fun MotQuiTient(mot: String, tous: List<String>, couleur: Color, max: TextUnit, modifier: Modifier = Modifier) {
    val mesure = rememberTextMeasurer()
    BoxWithConstraints(modifier, contentAlignment = Alignment.CenterStart) {
        val dispo = constraints.maxWidth
        val taille = remember(tous, mot, dispo, max) {
            fun tient(mots: List<String>): Float {
                var t = max.value
                while (t > 12f && mots.any { mesure.measure(it, styleCentre(t.sp, couleur, FontWeight.Bold), maxLines = 1, softWrap = false).size.width > dispo }) t -= 1f
                return t
            }
            val commune = maxOf(tient((tous + mot).distinct()), minOf(20f, max.value))
            minOf(commune, tient(listOf(mot))).sp
        }
        Text(mot, style = styleCentre(taille, couleur, FontWeight.Bold), maxLines = 1, softWrap = false, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun ChoiceCard(
    i: Int, text: String, correct: Int?, modifier: Modifier, express: Boolean = false, photo: ByteArray? = null, compacte: Boolean = false,
    imageDessus: Boolean = true, tous: List<String> = emptyList(),
) {
    val isCorrect = correct == i
    // Révélation au rythme du roulement : les mauvaises s'éteignent une à une (✗ corail), puis la bonne passe au vert.
    val rangMauvaise = if (correct == null) 0 else (0 until i).count { it != correct }
    val eteinte = apres(Tempo.mauvaiseSEteint(rangMauvaise, express), correct, actif = correct != null && !isCorrect)
    val juste = apres(Tempo.revelationOr(express), correct, actif = isCorrect)
    val dim by animateFloatAsState(if (eteinte) 0.35f else 1f, tween(350), label = "dim")
    val color = Palette.Choices[i % Palette.Choices.size]
    val forme = RoundedCornerShape(24.dp)
    // Palette A (audit du 19 octobre) : vert plein = juste, corail = faux ; ✓ et ✗ disent la même chose sans la couleur.
    // Une photo pas encore chargée ou illisible : la proposition s'affiche en texte, la partie ne l'attend pas.
    val image = photo?.let { remember(it) { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }.getOrNull() } }
    val cadre = modifier
        .rebond(juste)
        // Fond plein sous la carte image : en s'éteignant, l'image fond dans la nuit, jamais dans les néons du décor
        // qui passaient à travers les vignettes (cedric, 24 octobre).
        .clip(forme)
        .background(Neon.Nuit)
        .alpha(dim)
        .clip(forme)
        .then(
            if (juste) Modifier.background(Brush.verticalGradient(listOf(Neon.JusteClair, Neon.JusteProfond)))
            else Modifier.background(Palette.Panel),
        )
        .border(if (juste) 5.dp else 3.dp, if (juste) Color.White else if (eteinte) Neon.Faux else color, forme)
        .reflet(juste)
    if (image != null) {
        CarteImage(i, text, tous, image, juste, eteinte, color, imageDessus, cadre)
        return
    }
    if (Look.gs) return ChoiceCardGs(i, text, correct, modifier, express, compacte)
    Row(
        modifier
            .rebond(juste)
            .alpha(dim)
            .clip(forme)
            .then(
                if (juste) Modifier.background(Brush.verticalGradient(listOf(Neon.JusteClair, Neon.JusteProfond)))
                else Modifier.background(Palette.Panel),
            )
            .border(if (juste) 5.dp else 3.dp, if (juste) Color.White else if (eteinte) Neon.Faux else color, forme)
            .reflet(juste)
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        run {
            // Une colonne de 4 cartes basses (illustration à côté) : pastille et texte un peu plus petits pour tenir.
            Box(Modifier.size(if (compacte) 42.dp else 52.dp).clip(CircleShape).background(color), contentAlignment = Alignment.Center) {
                Text(Palette.ChoiceLetters[i], style = styleCentre(if (compacte) 23.sp else 28.sp, Color.White, FontWeight.Black))
            }
            Spacer(Modifier.width(if (compacte) 14.dp else 18.dp))
            Text(
                text, color = if (juste) Neon.JusteTexte else Palette.Ink, fontSize = if (compacte) 24.sp else 28.sp,
                lineHeight = if (compacte) 27.sp else TextUnit.Unspecified, fontWeight = FontWeight.Bold,
                maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
            )
        }
        when {
            juste -> Box(
                Modifier.size(if (compacte) 40.dp else 48.dp).apparition(100, Unit).clip(CircleShape).background(Color.White),
                contentAlignment = Alignment.Center,
            ) { Text("✓", style = styleCentre(if (compacte) 27.sp else 32.sp, Neon.JusteProfond, FontWeight.Black)) }
            eteinte -> Text("✗", color = Neon.Faux, fontSize = 32.sp, fontWeight = FontWeight.Black)
        }
    }
}

/** Carte d'une réponse en image : l'image en grand (recadrée comme dans la Régie PC), la lettre et le mot dessous ou à côté. */
@Composable
private fun CarteImage(i: Int, text: String, tous: List<String>, image: ImageBitmap, juste: Boolean, eteinte: Boolean, color: Color, dessus: Boolean, modifier: Modifier) {
    val lettre = Palette.ChoiceLetters[i]
    val encre = if (juste) Neon.JusteTexte else Palette.Ink
    @Composable
    fun Image() = androidx.compose.foundation.Image(
        image, contentDescription = "Réponse $lettre en image : $text", contentScale = ContentScale.Crop,
        modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(percent = 18)).background(Color.White),
    )
    @Composable
    fun Pastille(d: Dp) = Box(Modifier.size(d).clip(CircleShape).background(color), contentAlignment = Alignment.Center) {
        Text(lettre, style = styleCentre(if (d > 32.dp) 21.sp else 18.sp, Color.White, FontWeight.Black))
    }
    @Composable
    fun Verdict(d: Dp) {
        when {
            juste -> Box(Modifier.size(d).apparition(100, Unit).clip(CircleShape).background(Color.White), contentAlignment = Alignment.Center) {
                Text("✓", style = styleCentre(if (d > 32.dp) 24.sp else 21.sp, Neon.JusteProfond, FontWeight.Black))
            }
            eteinte -> Text("✗", style = styleCentre(26.sp, Neon.Faux, FontWeight.Black))
        }
    }
    Box(modifier) {
        if (dessus) {
            Column(Modifier.fillMaxSize().padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.weight(1f).aspectRatio(1f, matchHeightConstraintsFirst = true)) { Image() }
                Spacer(Modifier.height(6.dp))
                // Lettre, mot et verdict sur la ligne sous l'image : rien ne se pose sur l'image.
                Row(Modifier.height(34.dp), verticalAlignment = Alignment.CenterVertically) {
                    Pastille(30.dp)
                    Spacer(Modifier.width(8.dp))
                    MotQuiTient(text, tous, encre, 26.sp, Modifier.weight(1f, fill = false))
                    if (juste || eteinte) { Spacer(Modifier.width(8.dp)); Verdict(30.dp) }
                }
            }
        } else {
            BoxWithConstraints(Modifier.fillMaxSize().padding(8.dp)) {
            // L'image ne prend jamais plus de 45 % de la largeur : le mot garde sa place.
            val cote = minOf(maxHeight, maxWidth * 0.45f)
            Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(cote)) { Image() }
                Spacer(Modifier.width(10.dp))
                // Cartes basses (8 équipes) : la lettre et le verdict au-dessus du mot, pour lui laisser toute la largeur.
                Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.Center) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Pastille(28.dp)
                        if (juste || eteinte) { Spacer(Modifier.width(8.dp)); Verdict(28.dp) }
                    }
                    Spacer(Modifier.height(2.dp))
                    MotQuiTient(text, tous, encre, 26.sp, Modifier.fillMaxWidth())
                }
            }
            }
        }
    }
}

/** Pastille d'équipe sous la question : a répondu (sans dire quoi), puis points gagnés à la révélation. */
@Composable
private fun TeamStatus(
    rangGagnant: Int, team: Team, online: Boolean, answered: Boolean, points: Int?, choice: Int?,
    isNumber: Boolean = false, express: Boolean = false, compacte: Boolean = false, uneLigne: Boolean = false, modifier: Modifier = Modifier,
) {
    val color = team.color.toColor()
    // Les points tombent comme des tampons, une équipe gagnante après l'autre, juste après la bonne réponse.
    val delai = if (rangGagnant >= 0) Tempo.tampon(rangGagnant, express) else Tempo.revelationOr(express)
    val montre = apres(delai, points != null, actif = points != null)
    val revealedPoints = points.takeIf { montre }
    val taille = if (compacte) 14.sp else 16.sp
    val statut = when {
        revealedPoints != null -> (if (revealedPoints > 0) "+$revealedPoints" else "0") +
            // Pastille sur une ligne (5 équipes et plus) : les points seuls, le nom garde sa place.
            (if (uneLigne) "" else choice?.let { " · ${if (isNumber) "$it" else Palette.ChoiceLetters.getOrElse(it) { "?" }}" } ?: " · –")
        !online -> "hors ligne"
        answered -> if (compacte || uneLigne) "✓" else "a répondu ✓"
        else -> "…"
    }
    if (Look.gs) return TeamStatusGs(team, online, answered, revealedPoints, statut, compacte, modifier, uneLigne)
    Column(
        modifier
            .rebond(revealedPoints != null && revealedPoints > 0, 0.25f)
            .clip(RoundedCornerShape(16.dp))
            .background(if (answered || revealedPoints != null) color.copy(alpha = 0.35f) else Palette.Panel)
            .border(2.dp, if (online) color else Color.Gray, RoundedCornerShape(16.dp))
            .padding(horizontal = if (compacte) 8.dp else 12.dp, vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Nom et statut toujours sur une ligne : de 1 à 8 équipes, la pastille garde sa hauteur.
        Text(team.name, color = Palette.Ink, fontSize = taille, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
            statut,
            color = if (revealedPoints != null && revealedPoints > 0) Palette.Gold else Palette.InkSoft,
            fontSize = taille, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Chrono calé sur l'heure du serveur : le même temps restant sur la TV et sur les pupitres. */
@Composable
private fun Countdown(state: UiState.Playing) {
    val total = state.question?.durationMs ?: 1
    var remaining by remember { mutableLongStateOf(state.remainingMs) }
    LaunchedEffect(state.deadline, state.paused) {
        val deadline = state.deadline
        if (deadline == null) {
            remaining = state.remainingMs
            return@LaunchedEffect
        }
        // Pendant le décompte 3, 2, 1 de la reprise, le chrono reste figé.
        val start = state.resumeAt ?: 0L
        while (true) {
            remaining = (deadline - maxOf(System.currentTimeMillis() + state.serverOffset, start)).coerceAtLeast(0)
            if (remaining == 0L) break
            delay(100)
        }
    }
    val seconds = ((remaining + 999) / 1000).toInt()
    val urgent = seconds <= 5
    val fraction = remaining.toFloat() / total
    if (Look.gs) return CountdownGs(seconds, fraction)
    Box(
        Modifier.size(84.dp).drawBehind {
            val stroke = 8.dp.toPx()
            drawArc(Color.White.copy(alpha = 0.2f), 0f, 360f, false, style = Stroke(stroke), topLeft = Offset(stroke / 2, stroke / 2), size = Size(size.width - stroke, size.height - stroke))
            drawArc(if (urgent) Color(0xFFFF4D6D) else Palette.Gold, -90f, 360f * fraction, false, style = Stroke(stroke), topLeft = Offset(stroke / 2, stroke / 2), size = Size(size.width - stroke, size.height - stroke))
        },
        contentAlignment = Alignment.Center,
    ) {
        Text("$seconds", style = styleCentre(34.sp, if (urgent) Color(0xFFFF4D6D) else Palette.Ink, FontWeight.Black))
    }
}

@Composable
fun ScoresScreen(state: UiState.Playing, actions: TvActions) {
    // Fin du blind test : le bilan de ses morceaux trouvés plutôt que le classement général.
    if (state.blind != null && state.mime == null) {
        // Game Show : les mêmes tubes de verre que le tableau des scores et le podium (cedric, 24/10), remplis des
        // points gagnés pendant le blind test.
        if (Look.gs) {
            val b = state.blind ?: return
            val lignes = state.teams.map { t ->
                t to b.tracks.filter { it.status == BlindStatus.FOUND && it.team == t.uid }.sumOf { it.points }
            }.sortedByDescending { it.second }
            return ClassementGameShow(state, actions, "BILAN DU BLIND TEST", "Points gagnés pendant le blind test", lignes, emptyMap())
        }
        Column(Modifier.fillMaxSize().padding(horizontal = 40.dp, vertical = 24.dp)) {
            BlindBilanEcran(state, Modifier.weight(1f).fillMaxWidth())
            Row {
                Spacer(Modifier.weight(1f))
                if (!state.paused) NextButton(suiteLabel(state), actions.next, key = state.index)
            }
        }
        return
    }
    if (Look.gs) return ClassementGameShow(state, actions)
    Column(Modifier.fillMaxSize().padding(horizontal = 56.dp, vertical = 28.dp)) {
        Text("Classement", color = Palette.Ink, fontSize = 40.sp, fontWeight = FontWeight.Black)
        Text(
            when {
                state.mime?.picto == true -> "Après le Pictionary"
                state.mime != null -> "Après les mimes"
                else -> "Après ${state.etape ?: "la question ${state.index + 1}"}"
            },
            color = Palette.InkSoft, fontSize = 20.sp,
        )
        Spacer(Modifier.height(16.dp))
        Ranking(state, Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically) {
            LogoLmp(64.dp)
            Spacer(Modifier.weight(1f))
            if (!state.paused) NextButton(suiteLabel(state), actions.next, key = state.index)
        }
    }
}

/** Bouton du classement : résultats finaux, jeu suivant annoncé par son nom, ou question suivante du même jeu. */
internal fun suiteLabel(state: UiState.Playing): String = when {
    state.isLast -> "Résultats finaux"
    state.nextGame != null -> "Jeu suivant : ${state.nextGame.let { if (it.length > 26) it.take(25).trimEnd() + "…" else it }}"
    else -> "Question suivante"
}

@Composable
fun FinalScreen(state: UiState.Playing, actions: TvActions) {
    // Célébration de fin (de 1 à 8 équipes, égalité, personne n'a marqué) : habillage/Victoire.kt.
    Victoire(state.ranking.map { (team, score) -> Classee(team.name, team.color.toColor(), score) })
}

@Composable
private fun Ranking(state: UiState.Playing, modifier: Modifier) {
    val ranking = state.ranking
    val best = (ranking.firstOrNull()?.second ?: 0).coerceAtLeast(1)
    val couronne = apres(Tempo.CLASSEMENT_COURONNE, Unit)
    // Jusqu'à 8 équipes : au-delà de 5, les lignes se resserrent pour que tout tienne sans rogner les chiffres.
    val serre = ranking.size > 5
    val grand = if (serre) 24.sp else 30.sp
    Column(modifier, verticalArrangement = Arrangement.spacedBy(if (serre) 4.dp else 8.dp)) {
        ranking.forEachIndexed { i, (team, score) ->
            // Les scores montent depuis ceux d'avant la question, sur le compteur sonore.
            val compteur = remember(team.uid) { Animatable((score - (state.lastGain[team.uid] ?: 0)).coerceAtLeast(0).toFloat()) }
            LaunchedEffect(score) {
                delay(Tempo.CLASSEMENT_COMPTEUR)
                compteur.animateTo(score.toFloat(), tween(1_500, easing = FastOutSlowInEasing))
            }
            val shown = compteur.value.roundToInt()
            val width = compteur.value / best
            val color = team.color.toColor()
            Row(
                Modifier.weight(1f, fill = false).height(if (serre) 40.dp else 48.dp).apparition(90L * i, Unit)
                    .then(if (i == 0 && score > 0) Modifier.clip(RoundedCornerShape(24.dp)).background(Brush.horizontalGradient(listOf(Neon.Or.copy(alpha = 0.22f), Color.Transparent))) else Modifier),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // La couronne se pose à côté du rang, dans la ligne : rien ne dépasse du cadre, même en 1080p.
                Row(Modifier.width(66.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${i + 1}", color = if (i == 0) Palette.Gold else Palette.Ink, fontSize = grand, fontWeight = FontWeight.Black, maxLines = 1)
                    if (i == 0) Couronne(couronne && score > 0, Modifier.padding(start = 6.dp).size(26.dp, 18.dp))
                }
                Box(Modifier.size(22.dp).clip(CircleShape).background(color))
                Spacer(Modifier.width(12.dp))
                Text(
                    team.name, color = Palette.Ink, fontSize = if (serre) 22.sp else 26.sp, fontWeight = FontWeight.Bold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(240.dp),
                )
                Box(Modifier.weight(1f).height(26.dp).clip(RoundedCornerShape(13.dp)).background(Palette.Panel)) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(width.coerceIn(0.02f, 1f)).clip(RoundedCornerShape(13.dp)).background(Brush.horizontalGradient(listOf(color.copy(alpha = 0.35f), color))))
                }
                Spacer(Modifier.width(16.dp))
                Text("$shown", color = Palette.Ink, fontSize = grand, fontWeight = FontWeight.Black, maxLines = 1, modifier = Modifier.width(90.dp), textAlign = TextAlign.End)
                val gain = state.lastGain[team.uid] ?: 0
                Text(if (gain > 0) "+$gain" else "", color = Palette.Gold, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(70.dp), textAlign = TextAlign.End)
            }
        }
    }
}
