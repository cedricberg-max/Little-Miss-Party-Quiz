package com.littlemissparty.quiz.tv

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.em
import com.littlemissparty.quiz.tv.habillage.AvecPoliceLmp
import com.littlemissparty.quiz.tv.habillage.BonusMalus
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue

class MainActivity : ComponentActivity() {

    private val viewModel: GameViewModel by viewModels()
    private val updates: UpdateViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        CrashReporter.install(applicationContext)
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContent {
            val state by viewModel.state.collectAsState()
            val updateUi by updates.ui.collectAsState()
            val updateOpen by updates.open.collectAsState()
            val updateAvailable by updates.available.collectAsState()
            val updateOffer by updates.offer.collectAsState()
            val coup by viewModel.coup.collectAsState()
            val busy = gameInProgress(state)
            LaunchedEffect(busy) { updates.setBusy(busy) }
            // Police Baloo 2 « cartes néon » (choix de cedric) pour tous les textes qui n'en imposent pas une autre.
            PoliceDesEcrans {
            Box(Modifier.fillMaxSize()) {
            // Pictionary : le dessin en direct passe à part, pour ne redessiner que la feuille à chaque trait.
            CompositionLocalProvider(LocalDessin provides viewModel.dessin) {
            QuizTvApp(
                state = state,
                actions = TvActions(
                    next = viewModel::next,
                    togglePause = viewModel::togglePause,
                    pause = viewModel::pause,
                    unpause = viewModel::unpause,
                    retry = viewModel::retry,
                    resume = viewModel::resume,
                    newGame = viewModel::newGame,
                    // La partie active reste mémorisée : elle sera proposée au prochain lancement.
                    quit = ::finish,
                    showRegie = viewModel::showRegie,
                    hideRegie = viewModel::hideRegie,
                    removeRegies = viewModel::removeRegies,
                    showTablette = viewModel::showTablette,
                    hideTablette = viewModel::hideTablette,
                    confierTablette = viewModel::confierTablette,
                    checkUpdate = updates::show,
                    mimeStart = viewModel::mimeStart,
                    mimeFound = viewModel::mimeFound,
                    mimePass = viewModel::mimePass,
                    mimeStop = viewModel::mimeStop,
                    judgeBuzz = { ok -> viewModel.judgeBuzz(ok) },
                    blindReveal = viewModel::blindReveal,
                    blindSkip = viewModel::blindSkip,
                    chestRandom = viewModel::chestRandom,
                    potatoRandom = viewModel::potatoRandom,
                    givePoints = viewModel::givePoints,
                    requestAgain = viewModel::requestAgain,
                ),
                update = UpdateScreen(
                    ui = updateUi, open = updateOpen, available = updateAvailable, offer = updateOffer,
                    actions = UpdateActions(
                        search = updates::search,
                        download = updates::download,
                        cancelDownload = updates::cancelDownload,
                        install = updates::install,
                        openPermission = updates::openInstallPermission,
                        close = updates::hide,
                        acceptOffer = updates::acceptOffer,
                        declineOffer = updates::declineOffer,
                    ),
                ),
            )
            }
            // BONUS / MALUS de la régie, par-dessus le jeu sans rien arrêter (chrono, musique, pupitres).
            coup?.let { c -> key(c.id) { BonusMalus(c.nom, c.couleur.toColor(), c.delta, c.avant, c.apres) { viewModel.coupFini(c.id) } } }
            }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Retour des réglages Android ou de l'écran d'installation.
        updates.onResume()
    }
}

/**
 * Baloo 2 a des lignes très hautes (1,6 fois la taille du texte, contre 1,17 pour la police d'avant) : sans
 * interligne imposé, chaque texte des écrans grandissait d'un tiers et poussait le bas de l'écran hors de la TV
 * (code du salon, « Reprise automatique », boutons). On garde l'interligne d'avant, lettres centrées dans la ligne ;
 * les textes qui fixent le leur (habillage) ne changent pas.
 */
@Composable
private fun PoliceDesEcrans(contenu: @Composable () -> Unit) = AvecPoliceLmp {
    ProvideTextStyle(
        LocalTextStyle.current.merge(
            TextStyle(lineHeight = 1.2.em, lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)),
        ),
        contenu,
    )
}
