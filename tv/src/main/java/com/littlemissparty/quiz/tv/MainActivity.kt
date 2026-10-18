package com.littlemissparty.quiz.tv

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue

class MainActivity : ComponentActivity() {

    private val viewModel: GameViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        CrashReporter.install(applicationContext)
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContent {
            val state by viewModel.state.collectAsState()
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
                ),
            )
        }
    }
}
