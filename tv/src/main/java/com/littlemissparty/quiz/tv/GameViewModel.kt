package com.littlemissparty.quiz.tv

import android.app.Application
import android.media.AudioManager
import android.media.ToneGenerator
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import com.google.firebase.database.ValueEventListener
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

data class Team(val uid: String, val name: String, val color: String, val joinedAt: Long)

sealed interface UiState {
    data object MissingConfig : UiState
    data object Connecting : UiState
    data class Error(val message: String) : UiState
    data class Lobby(
        val code: String,
        val joinUrl: String,
        val teams: List<Team> = emptyList(),
        val round: Int = 1,
        val buzzerUid: String? = null,
    ) : UiState {
        val buzzer: Team? get() = teams.find { it.uid == buzzerUid }
    }
}

class GameViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow<UiState>(UiState.Connecting)
    val state: StateFlow<UiState> = _state

    private var game: DatabaseReference? = null
    private val listeners = mutableListOf<Pair<DatabaseReference, ValueEventListener>>()
    private val tones = runCatching { ToneGenerator(AudioManager.STREAM_MUSIC, 90) }.getOrNull()

    init {
        if (BuildConfig.FB_API_KEY.isBlank()) {
            _state.value = UiState.MissingConfig
        } else {
            start()
        }
    }

    fun start() {
        _state.value = UiState.Connecting
        viewModelScope.launch {
            try {
                val db = connect()
                val uid = FirebaseAuth.getInstance().currentUser!!.uid
                val code = createGame(db, uid)
                val ref = db.getReference("games/$code")
                game = ref
                _state.value = UiState.Lobby(code = code, joinUrl = joinUrl(code))
                listenGame(ref)
            } catch (e: Exception) {
                _state.value = UiState.Error(e.message ?: e.javaClass.simpleName)
            }
        }
    }

    /** Rouvre les buzzers pour un nouveau tour. */
    fun rearm() {
        val lobby = _state.value as? UiState.Lobby ?: return
        game?.child("state/round")?.setValue(lobby.round + 1)
    }

    private suspend fun connect(): FirebaseDatabase {
        val ctx = getApplication<Application>()
        if (FirebaseApp.getApps(ctx).isEmpty()) {
            val options = FirebaseOptions.Builder()
                .setApiKey(BuildConfig.FB_API_KEY)
                .setApplicationId(BuildConfig.FB_APP_ID)
                .setProjectId(BuildConfig.FB_PROJECT_ID)
                .setDatabaseUrl(databaseUrl())
                .build()
            FirebaseApp.initializeApp(ctx, options)
        }
        val auth = FirebaseAuth.getInstance()
        if (auth.currentUser == null) auth.signInAnonymously().await()
        return FirebaseDatabase.getInstance(databaseUrl())
    }

    private suspend fun createGame(db: FirebaseDatabase, uid: String): String {
        repeat(8) {
            val code = (1..5).map { CODE_CHARS.random() }.joinToString("")
            val ref = db.getReference("games/$code")
            if (!ref.get().await().exists()) {
                ref.setValue(
                    mapOf(
                        "hostUid" to uid,
                        "createdAt" to ServerValue.TIMESTAMP,
                        "state" to mapOf("phase" to "lobby", "buzzOpen" to true, "round" to 1),
                    )
                ).await()
                return code
            }
        }
        error("Impossible de créer une partie")
    }

    private fun listenGame(ref: DatabaseReference) {
        observe(ref) { snap ->
            val teams = snap.child("teams").children.mapNotNull { t ->
                val name = t.child("name").getValue(String::class.java) ?: return@mapNotNull null
                Team(
                    uid = t.key!!,
                    name = name,
                    color = t.child("color").getValue(String::class.java) ?: "#FF3CAC",
                    joinedAt = t.child("joinedAt").getValue(Long::class.java) ?: 0L,
                )
            }.sortedBy { it.joinedAt }
            val round = snap.child("state/round").getValue(Int::class.java) ?: 1
            val buzzerUid = snap.child("buzz/$round/team").getValue(String::class.java)
            updateLobby { lobby ->
                if (teams.size > lobby.teams.size) tones?.startTone(ToneGenerator.TONE_PROP_BEEP2, 200)
                if (buzzerUid != null && lobby.buzzerUid == null) {
                    tones?.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 600)
                }
                lobby.copy(teams = teams, round = round, buzzerUid = buzzerUid)
            }
        }
    }

    private fun updateLobby(transform: (UiState.Lobby) -> UiState.Lobby) {
        _state.update { s -> if (s is UiState.Lobby) transform(s) else s }
    }

    private fun observe(ref: DatabaseReference, onData: (DataSnapshot) -> Unit) {
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) = onData(snapshot)
            override fun onCancelled(error: DatabaseError) {
                _state.value = UiState.Error(error.message)
            }
        }
        ref.addValueEventListener(listener)
        listeners += ref to listener
    }

    override fun onCleared() {
        listeners.forEach { (ref, l) -> ref.removeEventListener(l) }
        tones?.release()
    }

    companion object {
        private const val CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

        fun joinUrl(code: String) = "https://${BuildConfig.FB_PROJECT_ID}.web.app/?g=$code"

        fun databaseUrl(): String = BuildConfig.FB_DATABASE_URL.ifBlank {
            "https://${BuildConfig.FB_PROJECT_ID}-default-rtdb.europe-west1.firebasedatabase.app"
        }
    }
}
