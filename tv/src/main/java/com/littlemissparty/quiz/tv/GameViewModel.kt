package com.littlemissparty.quiz.tv

import android.app.Application
import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import com.google.firebase.database.ValueEventListener
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
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

    /** Une partie non terminée a été retrouvée au démarrage. */
    data class ResumeOffer(val code: String, val teamNames: List<String>, val secondsLeft: Int) : UiState
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
    private var countdown: Job? = null
    private val prefs = app.getSharedPreferences("partie", Context.MODE_PRIVATE)

    /** Code de la partie en cours, mémorisé sur la box pour survivre à un crash ou un redémarrage. */
    private var activeCode: String?
        get() = prefs.getString("active_game", null)
        set(value) {
            prefs.edit().apply { if (value == null) remove("active_game") else putString("active_game", value) }.commit()
        }

    private val tones = runCatching { ToneGenerator(AudioManager.STREAM_MUSIC, 90) }.getOrNull()

    init {
        if (BuildConfig.FB_PROJECT_ID.isBlank()) {
            _state.value = UiState.MissingConfig
        } else {
            start()
        }
    }

    /**
     * Démarrage : si la box a une partie active non terminée, on propose de la reprendre
     * (reprise automatique au bout de [AUTO_RESUME_SECONDS]) au lieu d'en créer une nouvelle.
     */
    fun start() {
        _state.value = UiState.Connecting
        viewModelScope.launch {
            try {
                val db = connect()
                val uid = FirebaseAuth.getInstance().currentUser!!.uid
                val saved = activeCode
                if (saved != null) {
                    val offer = resumableGame(db, uid, saved)
                    if (offer != null) {
                        offerResume(offer)
                        return@launch
                    }
                    activeCode = null
                }
                open(db, createGame(db, uid))
            } catch (e: Exception) {
                _state.value = UiState.Error(e.message ?: e.javaClass.simpleName)
            }
        }
    }

    /** Reprend la partie proposée (ou la partie active après une erreur réseau). */
    fun resume() {
        countdown?.cancel()
        val code = (_state.value as? UiState.ResumeOffer)?.code ?: activeCode ?: return start()
        _state.value = UiState.Connecting
        viewModelScope.launch {
            try {
                open(connect(), code)
            } catch (e: Exception) {
                _state.value = UiState.Error(e.message ?: e.javaClass.simpleName)
            }
        }
    }

    /** « Réessayer » ne crée jamais de nouvelle partie si une partie est active. */
    fun retry() = if (activeCode != null) resume() else start()

    /** Termine la partie active (elle reste archivée dans Firebase) et en crée une nouvelle. */
    fun newGame() {
        countdown?.cancel()
        val previous = (_state.value as? UiState.ResumeOffer)?.code ?: activeCode
        _state.value = UiState.Connecting
        viewModelScope.launch {
            try {
                val db = connect()
                if (previous != null) {
                    db.getReference("games/$previous/state").updateChildren(
                        mapOf("phase" to "ended", "endedAt" to ServerValue.TIMESTAMP)
                    )
                }
                activeCode = null
                open(db, createGame(db, FirebaseAuth.getInstance().currentUser!!.uid))
            } catch (e: Exception) {
                _state.value = UiState.Error(e.message ?: e.javaClass.simpleName)
            }
        }
    }

    private suspend fun resumableGame(db: FirebaseDatabase, uid: String, code: String): UiState.ResumeOffer? {
        // Sans réseau ni copie locale, on fait confiance au code mémorisé.
        val snap = runCatching { db.getReference("games/$code").get().await() }.getOrNull()
            ?: return UiState.ResumeOffer(code, emptyList(), AUTO_RESUME_SECONDS)
        if (snap.child("hostUid").getValue(String::class.java) != uid) return null
        if (snap.child("state/phase").getValue(String::class.java) == "ended") return null
        val names = snap.child("teams").children.mapNotNull { it.child("name").getValue(String::class.java) }
        return UiState.ResumeOffer(code, names, AUTO_RESUME_SECONDS)
    }

    private fun offerResume(offer: UiState.ResumeOffer) {
        _state.value = offer
        countdown = viewModelScope.launch {
            for (s in AUTO_RESUME_SECONDS downTo 1) {
                _state.update { if (it is UiState.ResumeOffer) it.copy(secondsLeft = s) else it }
                delay(1000)
            }
            resume()
        }
    }

    private fun open(db: FirebaseDatabase, code: String) {
        stopListening()
        val ref = db.getReference("games/$code")
        game = ref
        activeCode = code
        _state.value = UiState.Lobby(code = code, joinUrl = joinUrl(code))
        listenGame(ref)
    }

    /** Rouvre les buzzers pour un nouveau tour. */
    fun rearm() {
        val lobby = _state.value as? UiState.Lobby ?: return
        game?.child("state/round")?.setValue(lobby.round + 1)
    }

    private suspend fun connect(): FirebaseDatabase {
        // FirebaseApp est initialisé automatiquement à partir de google-services.json.
        val auth = FirebaseAuth.getInstance()
        if (auth.currentUser == null) auth.signInAnonymously().await()
        return FirebaseDatabase.getInstance(databaseUrl()).also { db ->
            // Copie locale sur la box : les données restent lisibles si Internet coupe.
            if (!persistenceOn) {
                runCatching { db.setPersistenceEnabled(true) }
                persistenceOn = true
            }
        }
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

    private fun stopListening() {
        listeners.forEach { (ref, l) -> ref.removeEventListener(l) }
        listeners.clear()
    }

    override fun onCleared() {
        stopListening()
        tones?.release()
    }

    companion object {
        private var persistenceOn = false
        const val AUTO_RESUME_SECONDS = 15
        private const val CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

        fun joinUrl(code: String) = "https://${BuildConfig.FB_PROJECT_ID}.web.app/?g=$code"

        fun databaseUrl(): String = BuildConfig.FB_DATABASE_URL.ifBlank {
            "https://${BuildConfig.FB_PROJECT_ID}-default-rtdb.europe-west1.firebasedatabase.app"
        }
    }
}
