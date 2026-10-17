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
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContent {
            val state by viewModel.state.collectAsState()
            QuizTvApp(
                state = state,
                onRearm = viewModel::rearm,
                onRetry = viewModel::retry,
                onResume = viewModel::resume,
                onNewGame = viewModel::newGame,
                // La partie active reste mémorisée : elle sera proposée au prochain lancement.
                onQuit = ::finish,
            )
        }
    }
}
