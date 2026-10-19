package com.littlemissparty.quiz.tv

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
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
            Box(Modifier.fillMaxSize()) {
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
                    checkUpdate = updates::show,
                    mimeStart = viewModel::mimeStart,
                    mimeFound = viewModel::mimeFound,
                    mimePass = viewModel::mimePass,
                    mimeStop = viewModel::mimeStop,
                    judgeBuzz = { ok -> viewModel.judgeBuzz(ok) },
                    blindReveal = viewModel::blindReveal,
                    blindSkip = viewModel::blindSkip,
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
            // BONUS / MALUS de la régie, par-dessus le jeu sans rien arrêter (chrono, musique, pupitres).
            coup?.let { c -> key(c.id) { BonusMalus(c.nom, c.couleur.toColor(), c.delta, c.avant, c.apres) { viewModel.coupFini(c.id) } } }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Retour des réglages Android ou de l'écran d'installation.
        updates.onResume()
    }
}
