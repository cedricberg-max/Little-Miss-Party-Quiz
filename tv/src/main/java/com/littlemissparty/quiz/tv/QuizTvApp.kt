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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Release
import com.littlemissparty.quiz.tv.habillage.BalayageDore
import com.littlemissparty.quiz.tv.habillage.GeneriqueSalon
import com.littlemissparty.quiz.tv.habillage.GrilleEquipes
import com.littlemissparty.quiz.tv.habillage.HabillageEcran
import com.littlemissparty.quiz.tv.habillage.HabillageTv
import com.littlemissparty.quiz.tv.habillage.LogoQuiz
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
    val showRegie: () -> Unit,
    val hideRegie: () -> Unit,
    val removeRegies: () -> Unit,
    /** Ouvre la fenêtre « Rechercher une mise à jour ». */
    val checkUpdate: () -> Unit = {},
    /** Mimes à la télécommande : lancer le tour (équipe proposée), trouvé, passer, arrêter le tour. */
    val mimeStart: (String?) -> Unit = {},
    val mimeFound: () -> Unit = {},
    val mimePass: () -> Unit = {},
    val mimeStop: () -> Unit = {},
    /** Image floue à la télécommande : bonne (true) ou mauvaise réponse de l'équipe qui a buzzé. */
    val judgeBuzz: (Boolean) -> Unit = {},
    /** Blind test à la télécommande : révéler le morceau sans gagnant, le passer sans le révéler. */
    val blindReveal: () -> Unit = {},
    val blindSkip: () -> Unit = {},
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
fun QuizTvApp(state: UiState, actions: TvActions, update: UpdateScreen? = null) {
    // Bouton Retour pendant une partie : on met en pause et on demande confirmation au lieu de quitter.
    var confirmQuit by remember { mutableStateOf(false) }
    var pausedByDialog by remember { mutableStateOf(false) }
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
        when (state) {
            UiState.MissingConfig -> Message(
                "Configuration Firebase manquante",
                "Cette version a été compilée sans le fichier firebase-config.json.",
                onUpdate = actions.checkUpdate,
            )
            UiState.Connecting -> Connecting()
            is UiState.Error -> Message("Connexion impossible", state.message, actions.retry, actions.checkUpdate)
            is UiState.ResumeOffer -> ResumeOffer(state, actions.resume, actions.newGame)
            is UiState.Playing -> Playing(state, actions)
        }
        StatusCorner(state, update?.available?.takeIf { !gameInProgress(state) }, Modifier.align(Alignment.BottomStart))
    }
    if (confirmQuit && state is UiState.Playing) {
        val close = {
            confirmQuit = false
            if (pausedByDialog) actions.unpause()
            pausedByDialog = false
        }
        QuitDialog(
            paused = state.paused,
            onContinue = close,
            onRegie = { close(); actions.showRegie() },
            onUpdate = { close(); actions.checkUpdate() },
            onNewGame = { confirmQuit = false; pausedByDialog = false; actions.newGame() },
            onQuit = { confirmQuit = false; actions.quit() },
        )
    }
    if (state is UiState.Playing && state.showRegie) {
        RegieDialog(state, onClose = actions.hideRegie, onRemove = actions.removeRegies)
    }
    if (update != null && update.open) {
        UpdateDialog(update.ui, busy = gameInProgress(state), actions = update.actions)
    } else if (update?.offer != null && !gameInProgress(state) && !confirmQuit && !(state is UiState.Playing && state.showRegie)) {
        // La proposition attend le retour à l'accueil : jamais par-dessus une partie ou une autre fenêtre.
        UpdateOfferDialog(update.offer, update.actions)
    }
}

@Composable
private fun Playing(state: UiState.Playing, actions: TvActions) {
    when (state.phase) {
        Phase.LOBBY -> Lobby(state, actions)
        Phase.QUESTION, Phase.CLOSED, Phase.REVEAL ->
            if (state.mime?.picto == true) PictionaryScreen(state, actions)
            else if (state.mime != null) MimeScreen(state, actions) else QuestionScreen(state, actions)
        Phase.SCORES -> ScoresScreen(state, actions)
        Phase.ENDED -> FinalScreen(state, actions)
    }
    if (state.phase == Phase.LOBBY) GeneriqueSalon(state.code, state.childName, state.title)
    BalayageDore(
        when (state.phase) {
            Phase.LOBBY -> "salon"
            Phase.QUESTION, Phase.CLOSED, Phase.REVEAL -> "question ${state.index}"
            Phase.SCORES -> "classement ${state.index}"
            Phase.ENDED -> "fin"
        },
    )
    HabillageEcran(state)
    PauseLayer(state, actions.unpause)
}

/** Version installée et état de la connexion, en petit dans un coin. */
@Composable
private fun StatusCorner(state: UiState, available: Release?, modifier: Modifier) {
    val connected = (state as? UiState.Playing)?.connected ?: true
    val regies = (state as? UiState.Playing)?.regies ?: 0
    Row(modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(if (connected) Palette.Good else Color.Red))
        Spacer(Modifier.width(8.dp))
        Text(
            (if (connected) "" else "Hors connexion · ") + (if (regies > 0) "Régie reliée · " else "") +
                "v${BuildConfig.VERSION_NAME}" + (available?.let { " · mise à jour ${it.versionName} disponible (menu Retour)" } ?: ""),
            color = Palette.InkSoft, fontSize = 13.sp,
        )
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
        Modifier.fillMaxSize().padding(64.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Une partie est en cours", color = Color.White, fontSize = 48.sp, fontWeight = FontWeight.Black)
        Spacer(Modifier.height(12.dp))
        Text(
            "Code ${state.code}",
            color = Palette.Gold, fontSize = 36.sp, fontWeight = FontWeight.Black, letterSpacing = 6.sp,
        )
        Spacer(Modifier.height(16.dp))
        Text(
            if (state.teamNames.isEmpty()) "Équipes : liste indisponible hors connexion"
            else "Équipes : " + state.teamNames.joinToString(", "),
            color = Color.White.copy(alpha = 0.85f), fontSize = 24.sp, textAlign = TextAlign.Center,
            maxLines = 3, overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(40.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            TvButton("Reprendre la partie (${state.secondsLeft})", onResume, Modifier.focusRequester(focus), primary = true, fontSize = 26.sp)
            TvButton("Nouvelle partie", onNewGame)
        }
        Spacer(Modifier.height(24.dp))
        Text(
            "Reprise automatique dans ${state.secondsLeft} s",
            color = Color.White.copy(alpha = 0.7f), fontSize = 20.sp,
        )
    }
    LaunchedEffect(Unit) { focus.requestFocus() }
}

@Composable
private fun QuitDialog(
    paused: Boolean,
    onContinue: () -> Unit,
    onRegie: () -> Unit,
    onUpdate: () -> Unit,
    onNewGame: () -> Unit,
    onQuit: () -> Unit,
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
            Spacer(Modifier.height(4.dp))
            val wide = Modifier.fillMaxWidth()
            TvButton("Continuer la partie", onContinue, wide.focusRequester(focus), primary = true)
            TvButton("Code de secours de la régie", onRegie, wide, fontSize = 20.sp)
            TvButton("Rechercher une mise à jour", onUpdate, wide, fontSize = 20.sp)
            TvButton("Quitter l'application", onQuit, wide, fontSize = 20.sp)
            TvButton("Terminer et lancer une nouvelle partie", onNewGame, wide, accent = Palette.Pink, fontSize = 20.sp)
        }
        LaunchedEffect(Unit) { focus.requestFocus() }
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
    val qr = remember(state.joinUrl) { qrCode(state.joinUrl) }
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
            Spacer(Modifier.height(if (nombreuses) 12.dp else 32.dp))
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
            // La consigne du buzzer cède sa place à la liste dès 4 équipes.
            if (state.teams.isNotEmpty() && state.teams.size <= 3) {
                Text("En attendant : buzzez sur votre pupitre, autant que vous voulez !", color = Palette.Gold, fontSize = 22.sp)
                Spacer(Modifier.height(16.dp))
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
            Text("Scannez pour jouer", color = Palette.Night, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(16.dp))
            Image(qr, contentDescription = "QR code de la partie", modifier = Modifier.size(300.dp))
            Spacer(Modifier.height(16.dp))
            Text("Code de la partie", color = Palette.Night.copy(alpha = 0.6f), fontSize = 18.sp)
            Text(state.code, color = Palette.Pink, fontSize = 48.sp, fontWeight = FontWeight.Black, letterSpacing = 8.sp)
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

fun String.toColor(): Color =
    runCatching { Color(android.graphics.Color.parseColor(this)) }.getOrDefault(Palette.TeamFallback)
