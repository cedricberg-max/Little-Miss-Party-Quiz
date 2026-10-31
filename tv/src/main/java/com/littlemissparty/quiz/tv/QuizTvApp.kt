package com.littlemissparty.quiz.tv

import android.view.KeyEvent as AndroidKeyEvent
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Release
import com.littlemissparty.quiz.tv.habillage.BalayageDore
import com.littlemissparty.quiz.tv.habillage.Design
import com.littlemissparty.quiz.tv.habillage.GeneriqueSalon
import com.littlemissparty.quiz.tv.habillage.RobotGameShow
import com.littlemissparty.quiz.tv.habillage.GrilleEquipes
import com.littlemissparty.quiz.tv.habillage.HabillageEcran
import com.littlemissparty.quiz.tv.habillage.HabillageTv
import com.littlemissparty.quiz.tv.habillage.IntroLancement
import com.littlemissparty.quiz.tv.habillage.LogoQuiz
import com.littlemissparty.quiz.tv.habillage.Look
import com.littlemissparty.quiz.tv.habillage.enNeon
import com.littlemissparty.quiz.tv.habillage.Neon

/** Ce que l'animatrice peut faire depuis la télécommande. */
class TvActions(
    val next: () -> Unit,
    val togglePause: () -> Unit,
    val pause: () -> Unit,
    val unpause: () -> Unit,
    val retry: () -> Unit,
    val resume: () -> Unit,
    val newGame: () -> Unit,
    val quit: () -> Unit,
    /** « Terminer la partie et quitter » : la partie est terminée (rien à reprendre), puis l'appli se ferme. */
    val terminerEtQuitter: () -> Unit = quit,
    val showRegie: () -> Unit,
    val hideRegie: () -> Unit,
    val removeRegies: () -> Unit,
    /** « Reconnecter une tablette » : ouvrir, fermer, confier une équipe (appareil, équipe) à la nouvelle tablette. */
    val showTablette: () -> Unit = {},
    val hideTablette: () -> Unit = {},
    val confierTablette: (String, String) -> Unit = { _, _ -> },
    /** Ouvre la fenêtre « Rechercher une mise à jour ». */
    val checkUpdate: () -> Unit = {},
    /** Mimes à la télécommande : lancer le tour (équipe proposée), trouvé, passer, arrêter le tour. */
    val mimeStart: (String?) -> Unit = {},
    val mimeFound: () -> Unit = {},
    val mimePass: () -> Unit = {},
    val mimeSkip: () -> Unit = {},
    val mimeStop: () -> Unit = {},
    /** Image floue à la télécommande : bonne (true) ou mauvaise réponse de l'équipe qui a buzzé. */
    val judgeBuzz: (Boolean) -> Unit = {},
    /** Blind test à la télécommande : révéler le morceau sans gagnant, le passer sans le révéler. */
    val blindReveal: () -> Unit = {},
    val blindSkip: () -> Unit = {},
    /** Box refusée dans la Régie PC : renvoyer la demande d'activation. */
    val requestAgain: () -> Unit = {},
    /** Les coffres mystères à la télécommande : un coffre au hasard pour l'équipe qui joue. */
    val chestRandom: () -> Unit = {},
    /** « Ça va exploser ! » à la télécommande : la bombe part au hasard (tablette en panne). */
    val potatoRandom: () -> Unit = {},
    /** Statues musicales : la box a joué la chanson (son numéro) jusqu'au bout. */
    val statuesSongEnded: (Int) -> Unit = {},
    /** Le Duel des robots : l'image du PAN vient d'être envoyée à l'écran. */
    val duelPanShown: () -> Unit = {},
    /** Le Chrono de Buzzy : l'image où le chrono part de 0 vient d'être envoyée à l'écran. */
    val chronoShown: () -> Unit = {},
    /** « Donner des points » (menu Retour) : équipes choisies, montant (fête sans Internet). */
    val givePoints: (List<String>, Int) -> Unit = { _, _ -> },
    /** « Vider le cache des médias » (menu Retour), une fois confirmé. */
    val viderCache: () -> Unit = {},
    /** « Design » (menu Retour) : passe de Classique à The Game Show et inversement ; le choix reste sur la box. */
    val changerDesign: () -> Unit = {},
)

/** Mise à jour de l'appli depuis la TV : état de la fenêtre et version trouvée par la recherche discrète. */
class UpdateScreen(
    val ui: UpdateUi,
    val open: Boolean,
    val available: Release?,
    val actions: UpdateActions,
    /** Version à proposer d'elle-même, affichée seulement hors partie. */
    val offer: Release? = null,
)

@Composable
fun QuizTvApp(state: UiState, actions: TvActions, update: UpdateScreen? = null, vidage: VidageCache = VidageCache.Pret) {
    // Bouton Retour pendant une partie : on met en pause et on demande confirmation au lieu de quitter.
    var confirmQuit by remember { mutableStateOf(false) }
    var pausedByDialog by remember { mutableStateOf(false) }
    var pointsOpen by remember { mutableStateOf(false) }
    var cacheOpen by remember { mutableStateOf(false) }
    BackHandler(enabled = state is UiState.Playing) {
        val s = state as UiState.Playing
        if (s.phase == Phase.QUESTION && !s.paused) {
            actions.pause()
            pausedByDialog = true
        }
        confirmQuit = true
    }
    Box(
        Modifier
            .fillMaxSize()
            .onPreviewKeyEvent { e ->
                // Touche lecture/pause de la télécommande : pause du chrono.
                val playPause = e.nativeKeyEvent.keyCode == AndroidKeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
                    e.nativeKeyEvent.keyCode == AndroidKeyEvent.KEYCODE_MEDIA_PLAY ||
                    e.nativeKeyEvent.keyCode == AndroidKeyEvent.KEYCODE_MEDIA_PAUSE
                if (playPause && e.type == KeyEventType.KeyUp && state is UiState.Playing) {
                    actions.togglePause()
                    true
                } else {
                    false
                }
            },
    ) {
        // Décor du plateau et bande-son : suivent la partie sans jamais la modifier.
        HabillageTv(state)
        // Changement de design (menu Retour) : les écrans repartent de zéro dans le nouveau design, sans rien garder de
        // l'ancien (couleurs mémorisées). La partie, elle, ne bouge pas.
        key(Look.design) {
        when (state) {
            UiState.MissingConfig -> Message(
                "Configuration Firebase manquante",
                "Cette version a été compilée sans le fichier firebase-config.json.",
                onUpdate = actions.checkUpdate,
            )
            UiState.Connecting -> Connecting()
            is UiState.Error -> Message("Connexion impossible", state.message, actions.retry, actions.checkUpdate)
            is UiState.ResumeOffer -> ResumeOffer(state, actions.resume, actions.newGame)
            is UiState.TakingOver -> TakingOver(state)
            is UiState.Moved -> Moved(state, actions.newGame)
            is UiState.Locked -> Locked(state, actions.requestAgain, actions.checkUpdate)
            is UiState.Playing -> Playing(state, actions)
        }
        }
        StatusCorner(state, Modifier.align(Alignment.BottomStart))
    }
    if (confirmQuit && state is UiState.Playing) {
        val close = {
            confirmQuit = false
            if (pausedByDialog) actions.unpause()
            pausedByDialog = false
        }
        QuitDialog(
            code = state.code,
            paused = state.paused,
            onContinue = close,
            // Game Show : l'accueil reste neutre pour les invités, « Lancer la fête ! » est ici à la télécommande.
            onLaunch = if (Look.gs && state.phase == Phase.LOBBY && state.teams.isNotEmpty()) ({ close(); actions.next() }) else null,
            // La pause du menu dure jusqu'à la fermeture de la fenêtre des points.
            onPoints = { confirmQuit = false; pointsOpen = true },
            onRegie = { close(); actions.showRegie() },
            onTablette = { close(); actions.showTablette() },
            onUpdate = { close(); actions.checkUpdate() },
            // Comme les points : la pause du menu dure jusqu'à la fermeture de la fenêtre.
            onCache = { confirmQuit = false; cacheOpen = true },
            onDesign = actions.changerDesign,
            onNewGame = { confirmQuit = false; pausedByDialog = false; actions.newGame() },
            onQuit = { confirmQuit = false; actions.quit() },
            onTerminerEtQuitter = { confirmQuit = false; pausedByDialog = false; actions.terminerEtQuitter() },
        )
    }
    if (pointsOpen && state is UiState.Playing) {
        PointsDialog(
            teams = state.teams,
            scores = state.scores,
            onValidate = actions.givePoints,
            onClose = {
                pointsOpen = false
                if (pausedByDialog) actions.unpause()
                pausedByDialog = false
            },
        )
    }
    if (cacheOpen && state is UiState.Playing) {
        ViderCacheDialog(
            raison = vidageImpossible(state),
            vidage = vidage,
            onVider = actions.viderCache,
            onClose = {
                cacheOpen = false
                if (pausedByDialog) actions.unpause()
                pausedByDialog = false
            },
        )
    }
    if (state is UiState.Playing && state.showRegie) {
        RegieDialog(state, onClose = actions.hideRegie, onRemove = actions.removeRegies)
    }
    if (state is UiState.Playing && state.showTablette) {
        TabletteDialog(state, onClose = actions.hideTablette, onConfier = actions.confierTablette)
    }
    if (update != null && update.open) {
        UpdateDialog(update.ui, busy = manualUpdateBlocked(state), actions = update.actions)
    } else if (update?.offer != null && !gameInProgress(state) && !confirmQuit && !pointsOpen && !cacheOpen && !(state is UiState.Playing && (state.showRegie || state.showTablette))) {
        // La proposition attend le retour à l'accueil : jamais par-dessus une partie ou une autre fenêtre.
        UpdateOfferDialog(update.offer, update.actions)
    }
}

@Composable
private fun Playing(state: UiState.Playing, actions: TvActions) {
    when (state.phase) {
        Phase.LOBBY -> if (Look.gs) LobbyGameShow(state) else Lobby(state, actions)
        Phase.QUESTION, Phase.CLOSED, Phase.REVEAL ->
            if (state.intro) PresentationScreen(state, actions)
            else if (state.coffres != null || state.question?.isCoffres == true) CoffresScreen(state, actions)
            else if (state.question?.isGonfleur == true) GonfleurScreen(state, actions)
            else if (state.question?.isPatate == true) PatateScreen(state, actions)
            else if (state.question?.isDuel == true) DuelScreen(state, actions)
            else if (state.question?.isSimon == true) SimonScreen(state, actions)
            else if (state.question?.isChrono == true) ChronoScreen(state, actions)
            else if (state.mime?.picto == true) PictionaryScreen(state, actions)
            else if (state.mime != null) MimeScreen(state, actions) else QuestionScreen(state, actions)
        Phase.SCORES -> ScoresScreen(state, actions)
        Phase.ENDED -> FinalScreen(state, actions)
    }
    // Le Game Show n'a pas de générique à l'accueil : le robot y dort sur Get Lucky, la grande intro vient au lancement.
    if (state.phase == Phase.LOBBY && !Look.gs) GeneriqueSalon(state.code, state.childName, state.title)
    BalayageDore(
        when (state.phase) {
            Phase.LOBBY -> "salon"
            Phase.QUESTION, Phase.CLOSED, Phase.REVEAL -> "question ${state.index}"
            Phase.SCORES -> "classement ${state.index}"
            Phase.ENDED -> "fin"
        },
    )
    HabillageEcran(state)
    IntroLancement(state)
    // Design « The Game Show » : le robot animateur surgit à quelques moments (rien en design classique). En pause, il
    // passe après l'intermède (opaque), sinon ses numéros seraient dessinés dessous.
    if (!state.paused) RobotGameShow(state)
    PauseLayer(state, actions.unpause)
    if (state.paused) RobotGameShow(state)
}

/**
 * Pastille en bas à gauche : verte quand la régie est reliée, rouge sinon (régie absente ou connexion perdue).
 * Aucun numéro de version à l'écran (choix de cedric) : il se lit dans le menu Retour, « Rechercher une mise à jour ».
 */
@Composable
private fun StatusCorner(state: UiState, modifier: Modifier) {
    val connected = (state as? UiState.Playing)?.connected ?: true
    val regies = (state as? UiState.Playing)?.regies ?: 0
    val reliee = connected && regies > 0
    // Lue par les tests sur émulateur (et les lecteurs d'écran) : l'état exact derrière la couleur.
    val etat = listOfNotNull("Hors connexion".takeIf { !connected }, if (reliee) "Régie reliée" else "Régie non reliée").joinToString(" · ")
    Row(modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(12.dp).clip(CircleShape).background(if (reliee) Palette.Good else Color.Red).semantics { contentDescription = etat })
    }
}

/** Le bouton unique de l'animatrice : il a toujours le focus, OK sur la télécommande l'active. */
@Composable
fun NextButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, key: Any = label) {
    val focus = remember { FocusRequester() }
    TvButton("$label  ▶", onClick, modifier.focusRequester(focus), primary = true, fontSize = 26.sp)
    LaunchedEffect(key) { runCatching { focus.requestFocus() } }
}

@Composable
private fun ResumeOffer(state: UiState.ResumeOffer, onResume: () -> Unit, onNewGame: () -> Unit) {
    val focus = remember { FocusRequester() }
    Column(
        Modifier.fillMaxSize().padding(horizontal = 64.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Une partie est en cours", color = Color.White, fontSize = 48.sp, lineHeight = 56.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(12.dp))
        Text(
            "Code ${state.code}",
            color = Palette.Gold, fontSize = 36.sp, lineHeight = 42.sp, fontWeight = FontWeight.Black, letterSpacing = 6.sp,
        )
        Spacer(Modifier.height(16.dp))
        Text(
            if (state.teamNames.isEmpty()) "Équipes : liste indisponible hors connexion"
            else "Équipes : " + state.teamNames.joinToString(", "),
            color = Color.White.copy(alpha = 0.85f), fontSize = 24.sp, lineHeight = 30.sp, textAlign = TextAlign.Center,
            maxLines = 3, overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(32.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            TvButton("Reprendre la partie (${state.secondsLeft})", onResume, Modifier.focusRequester(focus), primary = true, fontSize = 26.sp)
            TvButton("Nouvelle partie", onNewGame)
        }
        Spacer(Modifier.height(24.dp))
        Text(
            "Reprise automatique dans ${state.secondsLeft} s",
            color = Color.White.copy(alpha = 0.7f), fontSize = 20.sp, lineHeight = 26.sp,
        )
    }
    LaunchedEffect(Unit) { focus.requestFocus() }
}

/** Box de secours : la partie que la régie vient de lui confier s'ouvre (quelques secondes). */
@Composable
private fun TakingOver(state: UiState.TakingOver) {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(color = Color.White)
        Spacer(Modifier.height(24.dp))
        Text("Reprise de la fête…", color = Color.White, fontSize = 36.sp, lineHeight = 42.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))
        Text(
            "Code ${state.code}",
            color = Palette.Gold, fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight.Black, letterSpacing = 6.sp,
        )
    }
}

/**
 * Ancienne box : la régie a confié la fête à une autre box pendant que celle-ci ne répondait plus.
 * Elle ne pilote plus rien ; « Nouvelle partie » ouvre un nouveau salon sans toucher à la fête.
 */
@Composable
private fun Moved(state: UiState.Moved, onNewGame: () -> Unit) {
    val focus = remember { FocusRequester() }
    Column(
        Modifier.fillMaxSize().padding(horizontal = 64.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        LogoQuiz(56.dp, aligne = Alignment.CenterHorizontally)
        Spacer(Modifier.height(16.dp))
        Text(
            "Cette fête continue sur une autre box", color = Color.White, fontSize = 44.sp, lineHeight = 52.sp,
            fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            "Code ${state.code}",
            color = Palette.Gold, fontSize = 32.sp, lineHeight = 40.sp, fontWeight = FontWeight.Black, letterSpacing = 6.sp,
        )
        Spacer(Modifier.height(16.dp))
        Text(
            "La régie l'a confiée à une autre TV, avec les mêmes équipes et les mêmes points.\nCette box ne la pilote plus.",
            color = Color.White.copy(alpha = 0.85f), fontSize = 22.sp, lineHeight = 30.sp, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(28.dp))
        TvButton("Nouvelle partie", onNewGame, Modifier.focusRequester(focus), primary = true, fontSize = 24.sp)
    }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
}

/** Box jamais acceptée : seulement son code, à retrouver dans la Régie PC (Paramètres > Box TV). */
@Composable
private fun Locked(state: UiState.Locked, onRequestAgain: () -> Unit, onUpdate: () -> Unit) {
    val focus = remember { FocusRequester() }
    // Tout tient sur un écran 720p, boutons côte à côte : rien ne doit sortir en bas de la TV.
    Column(
        Modifier.fillMaxSize().padding(horizontal = 64.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        LogoQuiz(56.dp, aligne = Alignment.CenterHorizontally)
        Spacer(Modifier.height(12.dp))
        Text(
            "Box en attente d'activation", color = Color.White, fontSize = 40.sp, lineHeight = 46.sp,
            fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            state.code, color = Palette.Gold, fontSize = 84.sp, lineHeight = 92.sp, fontWeight = FontWeight.Black,
            letterSpacing = 14.sp,
        )
        Text(state.model, color = Color.White.copy(alpha = 0.75f), fontSize = 20.sp, lineHeight = 26.sp)
        Spacer(Modifier.height(16.dp))
        Text(
            when {
                state.refused -> "La demande a été refusée dans la Régie PC."
                state.sent -> "Dans la Régie PC, ouvrez Paramètres, rubrique Box TV,\net acceptez la box qui affiche ce code."
                else -> "Envoi de la demande d'activation… Vérifiez la connexion Internet."
            },
            color = Color.White.copy(alpha = 0.85f), fontSize = 22.sp, lineHeight = 30.sp, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(20.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
            if (state.refused) {
                TvButton("Redemander l'activation", onRequestAgain, Modifier.focusRequester(focus), primary = true, fontSize = 20.sp)
                TvButton("Rechercher une mise à jour", onUpdate, fontSize = 20.sp)
            } else {
                TvButton("Rechercher une mise à jour", onUpdate, Modifier.focusRequester(focus), fontSize = 20.sp)
            }
        }
    }
    LaunchedEffect(state.refused) { runCatching { focus.requestFocus() } }
}

@Composable
private fun QuitDialog(
    code: String,
    paused: Boolean,
    onContinue: () -> Unit,
    onLaunch: (() -> Unit)?,
    onPoints: () -> Unit,
    onRegie: () -> Unit,
    onTablette: () -> Unit,
    onUpdate: () -> Unit,
    onCache: () -> Unit,
    onDesign: () -> Unit,
    onNewGame: () -> Unit,
    onQuit: () -> Unit,
    onTerminerEtQuitter: () -> Unit,
) {
    val focus = remember { FocusRequester() }
    // Fenêtre séparée : la télécommande ne peut pas atteindre les boutons de l'écran derrière.
    // Pleine largeur utile, dans la zone visible de la TV ; si l'écran est trop petit, la liste défile
    // et le bouton sélectionné reste toujours à l'écran.
    Dialog(onDismissRequest = onContinue, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier
                .padding(horizontal = 48.dp, vertical = 27.dp)
                .widthIn(max = 720.dp)
                .clip(RoundedCornerShape(32.dp))
                .background(Neon.Fond)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 44.dp, vertical = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(if (paused) "Partie en pause" else "Quitter la partie ?", color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.Bold)
            Text(
                "Si vous quittez, la partie reste enregistrée\net sera proposée au prochain démarrage.",
                color = Color.White.copy(alpha = 0.8f), fontSize = 20.sp, textAlign = TextAlign.Center,
            )
            // Le code de la partie n'est plus sur l'accueil (cedric, 24/10) : il reste ici, pour une reprise.
            Text("Code de la partie : $code", color = Palette.Gold, fontSize = 22.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
            Spacer(Modifier.height(4.dp))
            val wide = Modifier.fillMaxWidth()
            if (onLaunch != null) TvButton("Lancer la fête !  ▶", onLaunch, wide.focusRequester(focus), primary = true)
            TvButton("Continuer la partie", onContinue, if (onLaunch == null) wide.focusRequester(focus) else wide, primary = onLaunch == null)
            TvButton("Donner des points", onPoints, wide, fontSize = 20.sp)
            TvButton("Reconnecter la régie", onRegie, wide, fontSize = 20.sp)
            TvButton("Reconnecter une tablette", onTablette, wide, fontSize = 20.sp)
            TvButton("Rechercher une mise à jour", onUpdate, wide, fontSize = 20.sp)
            TvButton("Vider le cache des médias", onCache, wide, fontSize = 20.sp)
            // La fenêtre reste ouverte : l'écran derrière change de design aussitôt, un second appui revient en arrière.
            TvButton("🎨 Design : ${Look.design.nom}", onDesign, wide, fontSize = 20.sp)
            TvButton("Quitter l'application", onQuit, wide, fontSize = 20.sp)
            TvButton("Terminer et lancer une nouvelle partie", onNewGame, wide, accent = Palette.Pink, fontSize = 20.sp)
            // Fin de soirée (cedric, 31/10) : terminer la partie et fermer l'appli d'un coup, rien à reprendre ensuite.
            TvButton("Terminer la partie et quitter", onTerminerEtQuitter, wide, accent = Palette.Pink, fontSize = 20.sp)
        }
        // Une équipe arrive pendant que la fenêtre est ouverte : « Lancer la fête ! » apparaît et prend la sélection.
        LaunchedEffect(onLaunch != null) { runCatching { focus.requestFocus() } }
    }
}

@Composable
private fun Connecting() {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(color = Color.White)
        Spacer(Modifier.height(24.dp))
        Text("Préparation de la partie…", color = Color.White, fontSize = 28.sp)
    }
}

@Composable
private fun Message(title: String, detail: String, onRetry: (() -> Unit)? = null, onUpdate: (() -> Unit)? = null) {
    val focus = remember { FocusRequester() }
    Column(
        Modifier.fillMaxSize().padding(64.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, color = Color.White, fontSize = 40.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        Text(detail, color = Color.White.copy(alpha = 0.8f), fontSize = 22.sp, textAlign = TextAlign.Center)
        if (onRetry != null) {
            Spacer(Modifier.height(32.dp))
            TvButton("Réessayer", onRetry, Modifier.focusRequester(focus), primary = true)
            LaunchedEffect(Unit) { focus.requestFocus() }
        }
        if (onUpdate != null) {
            Spacer(Modifier.height(16.dp))
            TvButton("Rechercher une mise à jour", onUpdate, fontSize = 20.sp)
        }
    }
}

@Composable
private fun Lobby(state: UiState.Playing, actions: TvActions) {
    val lien = lienPupitre(state.joinUrl)
    val qr = remember(lien) { qrCode(lien) }
    Row(Modifier.fillMaxSize().padding(horizontal = 56.dp, vertical = 40.dp)) {
        Column(Modifier.weight(1f).fillMaxHeight()) {
            Title()
            // Au-delà de 4 équipes, on resserre pour que toutes tiennent au-dessus de « Lancer la fête ! ».
            val nombreuses = state.teams.size > 4
            // Prestation chargée depuis la régie : on accueille l'enfant fêté par son prénom.
            when {
                state.childName.isNotBlank() -> Text(
                    "Joyeux anniversaire ${state.childName} !", color = Palette.Gold, fontSize = if (nombreuses) 26.sp else 34.sp,
                    fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                state.title.isNotBlank() -> Text(
                    state.title, color = Palette.Gold, fontSize = if (nombreuses) 24.sp else 30.sp, fontWeight = FontWeight.Bold,
                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.height(if (nombreuses) 12.dp else if (state.teams.isEmpty()) 32.dp else 16.dp))
            Text(
                when {
                    state.teams.isEmpty() -> "En attente des équipes…"
                    state.teams.size >= GameViewModel.MAX_TEAMS -> "${state.teams.size} équipes : la partie est complète"
                    else -> "${state.teams.size} équipe(s) dans la partie"
                },
                color = Color.White, fontSize = if (nombreuses) 20.sp else 26.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
            )
            Spacer(Modifier.height(if (nombreuses) 10.dp else 16.dp))
            // De 1 à 8 équipes : la grille prend la place libre et se resserre, sans jamais pousser le bouton hors de l'écran.
            Box(Modifier.weight(1f).fillMaxWidth()) {
                GrilleEquipes(state.teams.size) { i, compacte, m ->
                    val team = state.teams.getOrNull(i) ?: return@GrilleEquipes
                    TeamChip(team, online = team.uid in state.online, buzz = state.funBuzzes[team.uid] ?: 0, compacte = compacte, modifier = m)
                }
            }
            // La consigne du buzzer cède sa place à la liste dès 4 équipes. Une seule ligne, sous les équipes : sur une TV
            // de 540 dp de haut, deux lignes rognaient la vignette de l'équipe (vu chez cedric en 0.1.414).
            if (state.teams.isNotEmpty() && state.teams.size <= 3) {
                Spacer(Modifier.height(8.dp))
                Text(
                    "En attendant, buzzez autant que vous voulez !", color = Palette.Gold, fontSize = 20.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(12.dp))
            }
            if (state.teams.isNotEmpty()) NextButton("Lancer la fête !", actions.next)
        }
        Spacer(Modifier.width(40.dp))
        Column(
            Modifier
                .fillMaxHeight()
                .clip(RoundedCornerShape(32.dp))
                .background(Color.White)
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Scannez pour jouer", color = Palette.Night, fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(14.dp))
            // Le QR prend la place qui reste (300 dp au plus) : le code de la partie dessous est toujours entier.
            Image(
                qr, contentDescription = "QR code de la partie",
                modifier = Modifier.weight(1f, fill = false).sizeIn(maxWidth = 300.dp, maxHeight = 300.dp).aspectRatio(1f),
            )
            Spacer(Modifier.height(14.dp))
            Text("Code de la partie", color = Palette.Night.copy(alpha = 0.6f), fontSize = 18.sp, lineHeight = 22.sp)
            Text(state.code, color = Palette.Pink, fontSize = 48.sp, lineHeight = 54.sp, fontWeight = FontWeight.Black, letterSpacing = 8.sp)
        }
    }
}

@Composable
private fun Title() {
    val t = rememberInfiniteTransition(label = "title")
    val pulse by t.animateFloat(
        1f, 1.03f, infiniteRepeatable(tween(1000, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "pulse",
    )
    // Le logo officiel (image), « QUIZ » en or dessous, et la même petite pompe qu'avant.
    // Hauteur fixe, proche de l'ancien logo en texte : il ne pousse jamais « Lancer la fête ! » hors de l'écran.
    LogoQuiz(84.dp, Modifier.graphicsLayer { scaleX = pulse; scaleY = pulse; transformOrigin = TransformOrigin(0f, 0.5f) })
}

@Composable
fun TeamChip(
    team: Team, online: Boolean = true, buzz: Int = 0, trailing: (@Composable () -> Unit)? = null,
    compacte: Boolean = false, modifier: Modifier = Modifier,
) {
    val pop = remember(team.uid) { Animatable(0f) }
    LaunchedEffect(team.uid) {
        pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow))
    }
    // Buzzer de l'accueil : la pastille de l'équipe saute et s'allume à sa couleur, sans rien bloquer.
    val flash = remember(team.uid) { Animatable(0f) }
    LaunchedEffect(buzz) {
        if (buzz > 0) {
            flash.snapTo(1f)
            flash.animateTo(0f, tween(650, easing = FastOutSlowInEasing))
        }
    }
    val bg = lerp(Color.White.copy(alpha = if (online) 0.15f else 0.06f), team.color.toColor(), flash.value * 0.85f)
    Row(
        modifier
            .graphicsLayer {
                val k = pop.value * (1f + 0.18f * flash.value)
                scaleX = k
                scaleY = k
                rotationZ = 4f * flash.value * if (buzz % 2 == 0) 1f else -1f
            }
            .clip(RoundedCornerShape(50))
            .background(bg)
            .padding(horizontal = if (compacte) 12.dp else 20.dp, vertical = if (compacte) 4.dp else 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(if (compacte) 18.dp else 28.dp).clip(CircleShape).background(team.color.toColor().copy(alpha = if (online) 1f else 0.35f)))
        Spacer(Modifier.width(if (compacte) 8.dp else 12.dp))
        Text(
            team.name, color = Color.White.copy(alpha = if (online) 1f else 0.5f), fontSize = if (compacte) 17.sp else 26.sp,
            fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
        )
        if (!online) {
            Spacer(Modifier.width(if (compacte) 6.dp else 10.dp))
            Text("hors ligne", color = Palette.Gold, fontSize = if (compacte) 13.sp else 16.sp, maxLines = 1)
        }
        trailing?.let { Spacer(Modifier.width(12.dp)); it() }
    }
}

/** Couleur d'équipe ; en design « The Game Show », sa version néon (même teinte, pleine lumière). */
fun String.toColor(): Color =
    runCatching { Color(android.graphics.Color.parseColor(this)) }.getOrDefault(Palette.TeamFallback).let { if (Look.gs) enNeon(it) else it }

/** Lien des pupitres : les tablettes prennent le même design que la TV (Classique ou The Game Show). */
// Les pupitres n'ont que deux looks : le fond 3D de la TV garde celui du Game Show.
fun lienPupitre(joinUrl: String): String = "$joinUrl&look=${if (Look.gs) Design.GAME_SHOW.cle else Design.CLASSIQUE.cle}"
