package com.littlemissparty.quiz.tv

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
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
            val busy = gameInProgress(state)
            LaunchedEffect(busy) { updates.setBusy(busy) }
            QuizTvApp(
                state = state,
                actions = TvActions(
                    next = viewModel::next,
                    togglePause = viewModel::togglePause,
                    pause = viewModel::pause,
                    unpause = viewModel::unpause,
                    rearm = viewModel::rearm,
                    retry = viewModel::retry,
                    resume = viewModel::resume,
                    newGame = viewModel::newGame,
                    // La partie active reste mémorisée : elle sera proposée au prochain lancement.
                    quit = ::finish,
                    showRegie = viewModel::showRegie,
                    hideRegie = viewModel::hideRegie,
                    removeRegies = viewModel::removeRegies,
                    checkUpdate = updates::show,
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
    }

    override fun onResume() {
        super.onResume()
        // Retour des réglages Android ou de l'écran d'installation.
        updates.onResume()
    }
}
