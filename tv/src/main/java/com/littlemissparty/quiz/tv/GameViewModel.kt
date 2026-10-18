package com.littlemissparty.quiz.tv

import android.app.Application
import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.SystemClock
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.database.ChildEventListener
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import com.google.firebase.database.ValueEventListener
import com.littlemissparty.quiz.engine.Answer
import com.littlemissparty.quiz.engine.Award
import com.littlemissparty.quiz.engine.Codec
import com.littlemissparty.quiz.engine.Command
import com.littlemissparty.quiz.engine.CommandResult
import com.littlemissparty.quiz.engine.CommandStatus
import com.littlemissparty.quiz.engine.Game
import com.littlemissparty.quiz.engine.GameEvent
import com.littlemissparty.quiz.engine.PAUSE_TEAM
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.engine.Quiz
import com.littlemissparty.quiz.engine.QuizJson
import com.littlemissparty.quiz.engine.Resumed
import com.littlemissparty.quiz.engine.execute
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import java.security.SecureRandom
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class Team(val uid: String, val name: String, val color: String, val joinedAt: Long)

sealed interface UiState {
    data object MissingConfig : UiState
    data object Connecting : UiState
    data class Error(val message: String) : UiState

    /** Une partie non terminée a été retrouvée au démarrage. */
    data class ResumeOffer(val code: String, val teamNames: List<String>, val secondsLeft: Int) : UiState

    /** Partie ouverte, du salon d'attente jusqu'aux résultats. */
    data class Playing(
        val code: String,
        val joinUrl: String,
        val teams: List<Team> = emptyList(),
        val online: Set<String> = emptySet(),
        val phase: Phase = Phase.LOBBY,
        val question: Question? = null,
        val index: Int = -1,
        val total: Int = 0,
        val paused: Boolean = false,
        /** Pause automatique (pupitre déconnecté) ou de l'animatrice : seule la régie voit l'équipe concernée. */
        val pauseReason: String? = null,
        /** Fin du décompte 3, 2, 1 de la dernière reprise (heure du serveur). */
        val resumeAt: Long? = null,
        /** Heure du serveur où le chrono atteint zéro (null en pause ou hors question). */
        val deadline: Long? = null,
        val remainingMs: Long = 0,
        val answered: Set<String> = emptySet(),
        val awards: Map<String, Award> = emptyMap(),
        val scores: Map<String, Int> = emptyMap(),
        /** Points de la question qui vient d'être révélée, pour l'animation des scores. */
        val lastGain: Map<String, Int> = emptyMap(),
        val isLast: Boolean = false,
        val round: Int = 1,
        val buzzerUid: String? = null,
        val connected: Boolean = true,
        /** Écart entre l'horloge de la box et celle du serveur, pour afficher le bon chrono. */
        val serverOffset: Long = 0,
        /** Code à 4 chiffres de secours, propre à cette partie, jamais écrit dans Firebase. */
        val regiePin: String = "",
        val regies: Int = 0,
        val showRegie: Boolean = false,
        /** Prestation chargée par la régie (titre et prénom de l'enfant fêté), vide pour le quiz de démonstration. */
        val title: String = "",
        val childName: String = "",
    ) : UiState {
        val buzzer: Team? get() = teams.find { it.uid == buzzerUid }
        val ranking: List<Pair<Team, Int>>
            get() = teams.map { it to (scores[it.uid] ?: 0) }.sortedWith(compareByDescending<Pair<Team, Int>> { it.second }.thenBy { it.first.joinedAt })
    }
}

/**
 * La box est l'unique arbitre de la partie : elle seule fait avancer le jeu et calcule les points.
 * Chaque action est inscrite dans le journal Firebase (`log/`) en même temps que l'état public (`state`),
 * en une seule écriture : après un redémarrage, la partie se reconstruit à l'identique depuis le journal.
 */
class GameViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow<UiState>(UiState.Connecting)
    val state: StateFlow<UiState> = _state

    private var gameRef: DatabaseReference? = null
    private var game: Game? = null
    private val listeners = mutableListOf<Pair<DatabaseReference, ValueEventListener>>()
    private var answersListener: Pair<DatabaseReference, ValueEventListener>? = null
    private var answers: Map<String, Answer> = emptyMap()
    private var countdown: Job? = null
    private var timer: Job? = null
    private val actions = Mutex()
    private var serverOffset = 0L
    private var commandsListener: Pair<DatabaseReference, ChildEventListener>? = null
    private val handledCommands = mutableSetOf<String>()
    private var regieUids: Set<String> = emptySet()
    private val judging = mutableSetOf<String>()
    private var pinFailures = 0
    private var pinLockedUntil = 0L
    /** Dernier chargement de prestation jugé par la box (appliqué ou refusé) : jamais rejugé. */
    private var judgedShow: String? = null
    /** Pupitres connectés au dernier relevé, et pupitres tout juste décrochés (délai de grâce en cours). */
    private var online: Set<String> = emptySet()
    private val dropTimers = mutableMapOf<String, Job>()
    /** Dernier appui sur OK pris en compte (anti double appui). */
    private var lastNextAt = -NEXT_GUARD_MS
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

    private fun serverNow() = System.currentTimeMillis() + serverOffset

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
                fail(e)
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
                fail(e)
            }
        }
    }

    /** « Réessayer » ne crée jamais de nouvelle partie si une partie est active. */
    fun retry() = if (activeCode != null) resume() else start()

    /** Termine la partie active (elle reste archivée dans Firebase) et en crée une nouvelle. */
    fun newGame() {
        countdown?.cancel()
        timer?.cancel()
        val previous = (_state.value as? UiState.ResumeOffer)?.code ?: activeCode
        _state.value = UiState.Connecting
        viewModelScope.launch {
            try {
                val db = connect()
                if (previous != null) {
                    db.getReference("games/$previous/state").updateChildren(
                        mapOf("phase" to Phase.ENDED.code, "endedAt" to ServerValue.TIMESTAMP)
                    )
                }
                activeCode = null
                open(db, createGame(db, FirebaseAuth.getInstance().currentUser!!.uid))
            } catch (e: Exception) {
                fail(e)
            }
        }
    }

    private fun fail(e: Exception) {
        Log.e(TAG, "Erreur", e)
        _state.value = UiState.Error(e.message ?: e.javaClass.simpleName)
    }

    private suspend fun resumableGame(db: FirebaseDatabase, uid: String, code: String): UiState.ResumeOffer? {
        val read = runCatching { db.getReference("games/$code").readOnce() }
        // Lecture refusée : cette box n'est plus l'hôte de la partie (données effacées, autre compte).
        if (read.exceptionOrNull()?.message?.contains("ermission") == true) return null
        // Sans réseau ni copie locale (ou base muette), on fait confiance au code mémorisé.
        val snap = read.getOrNull() ?: return UiState.ResumeOffer(code, emptyList(), AUTO_RESUME_SECONDS)
        if (snap.child("hostUid").getValue(String::class.java) != uid) return null
        if (snap.child("state/phase").getValue(String::class.java) == Phase.ENDED.code) return null
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

    private fun loadQuiz(id: String?): Quiz {
        val name = if (id.isNullOrBlank()) DEFAULT_QUIZ else id
        val assets = getApplication<Application>().assets
        val json = runCatching { assets.open("quizzes/$name.json") }.getOrElse { assets.open("quizzes/$DEFAULT_QUIZ.json") }
            .bufferedReader().use { it.readText() }
        return QuizJson.parse(json)
    }

    /** Ouvre une partie : relit le journal, reconstruit l'état, reprend là où on en était. */
    private suspend fun open(db: FirebaseDatabase, code: String) {
        stopListening()
        timer?.cancel()
        val ref = db.getReference("games/$code")
        gameRef = ref
        activeCode = code
        val snap = ref.readOnce() ?: error("La base Firebase ne répond pas. Vérifiez Internet puis réessayez.")
        // Prestation chargée par la régie et acceptée : la box la rejoue telle quelle, sans relire la bibliothèque.
        val show = snap.child("show")
        val showApplied = show.child("id").value != null &&
            snap.child("showStatus/id").value == show.child("id").value &&
            snap.child("showStatus/status").getValue(String::class.java) == "applied"
        val quiz = (if (showApplied) runCatching { QuizJson.fromValue(show.child("quiz").value) }.getOrNull() else null)
            ?: loadQuiz(snap.child("quizId").getValue(String::class.java))
        judgedShow = snap.child("showStatus/id").getValue(String::class.java)
        val history = snap.child("log").children.mapNotNull { (it.value as? Map<*, *>)?.let(Codec::decode) }
        val g = Game(quiz, history)
        game = g
        val round = snap.child("state/round").getValue(Int::class.java) ?: 1
        // Commandes de la régie déjà traitées avant un redémarrage : jamais appliquées deux fois.
        handledCommands.clear()
        snap.child("commandStatus").children.mapNotNullTo(handledCommands) { it.key }
        regieUids = snap.child("regie").children.mapNotNull { it.key }.toSet()
        pinFailures = snap.child("pairingLock/failures").getValue(Int::class.java) ?: 0
        pinLockedUntil = snap.child("pairingLock/until").getValue(Long::class.java) ?: 0L
        _state.value = UiState.Playing(
            code = code, joinUrl = joinUrl(code), total = quiz.questions.size, round = round,
            // Équipes connues dès l'ouverture : une commande reçue avant leur chargement est jugée correctement.
            teams = parseTeams(snap.child("teams")),
            regiePin = regiePin(code), regies = regieUids.size,
            title = if (showApplied) quiz.title else "",
            childName = if (showApplied) show.child("childName").getValue(String::class.java).orEmpty() else "",
        )
        // Le conducteur (questions et bonnes réponses) n'est lisible que par les régies reliées.
        ref.child("conducteur").setValue(conducteur(quiz))
        publishPublic()
        listenGame(db, ref)
        listenCommands(ref)
        refresh()
        recover()
    }

    /**
     * Après une reprise : une question dont le chrono a expiré pendant la coupure est fermée,
     * une question fermée mais pas encore révélée reste en attente du bouton de l'animatrice.
     */
    private fun recover() {
        val g = game ?: return
        if (g.state.phase == Phase.QUESTION && !g.state.paused && g.remainingMs(serverNow()) == 0L) {
            act { it.close(serverNow()) }
        } else {
            schedule()
        }
    }

    // ---------- Actions de l'animatrice à la télécommande (secours de la régie) ----------

    /** Bouton principal : fait avancer la partie d'une étape. */
    fun next() {
        // Double appui sur OK : le second toucherait le bouton suivant, qui vient de prendre le focus.
        val now = SystemClock.elapsedRealtime()
        if (now - lastNextAt < NEXT_GUARD_MS) return
        lastNextAt = now
        viewModelScope.launch { actions.withLock {
            val g = game ?: return@withLock
            when (g.state.phase) {
                Phase.LOBBY -> if (teams().isNotEmpty()) commit(g.next(serverNow()))
                Phase.CLOSED -> commit(g.reveal(serverNow(), collectAnswers()))
                else -> commit(g.next(serverNow()))
            }
        } }
    }

    fun togglePause() = act { g -> if (g.state.paused) g.resume(serverNow()) else g.pause(serverNow()) }
    fun pause() = act { it.pause(serverNow()) }
    fun unpause() = act { it.resume(serverNow()) }

    /** Réarme le buzzer de test du salon. */
    fun rearm() {
        val s = _state.value as? UiState.Playing ?: return
        if (s.phase != Phase.LOBBY) return
        _state.value = s.copy(round = s.round + 1, buzzerUid = null)
        publishState()
    }

    private fun act(action: (Game) -> GameEvent?) {
        viewModelScope.launch { actions.withLock { game?.let { commit(action(it)) } } }
    }

    /**
     * Enregistre l'événement (journal + état public en une seule écriture) et met l'écran à jour.
     * [extra] part dans la même écriture (réponse à la commande de la régie qui l'a déclenché).
     */
    private fun commit(event: GameEvent?, extra: Map<String, Any?> = emptyMap()) {
        val g = game ?: return
        val ref = gameRef ?: return
        if (event == null) return
        val round = (_state.value as? UiState.Playing)?.round ?: 1
        // Sans réseau, Firebase garde l'écriture en file d'attente et l'envoie au retour de la connexion.
        ref.updateChildren(
            mapOf(
                "log/${Codec.key(event.seq)}" to clean(Codec.encode(event)),
                "state" to clean(Codec.publicState(g, round)),
            ) + extra
        ).addOnFailureListener { Log.e(TAG, "Écriture refusée", it) }
        if (event is Resumed) countdownBeeps(event) else sound(g.state.phase)
        refresh()
        schedule()
    }

    private fun publishState() {
        val g = game ?: return
        val round = (_state.value as? UiState.Playing)?.round ?: 1
        gameRef?.child("state")?.setValue(clean(Codec.publicState(g, round)))
    }

    /** Réponses retenues : celles des équipes inscrites (8 au plus), relues sur le serveur si possible. */
    private suspend fun collectAnswers(): Map<String, Answer> {
        val g = game ?: return emptyMap()
        val qid = g.state.qid ?: return emptyMap()
        // La fermeture a été envoyée avant cette lecture : le serveur la traite d'abord, les règles refusent
        // ensuite toute réponse, donc la liste relue est définitive.
        val fresh = withTimeoutOrNull(4000) {
            gameRef?.child("answers/$qid")?.get()?.await()?.let(::parseAnswers)
        }
        val known = teams().map { it.uid }.toSet()
        return (fresh ?: answers).filterKeys { it in known }
    }

    private fun teams(): List<Team> = (_state.value as? UiState.Playing)?.teams.orEmpty()

    /** Ferme automatiquement la question à la fin du chrono. */
    private fun schedule() {
        timer?.cancel()
        val g = game ?: return
        val deadline = g.deadline() ?: return
        timer = viewModelScope.launch {
            delay((deadline - serverNow() + CLOSE_GRACE_MS).coerceAtLeast(0))
            actions.withLock {
                if (g.state.phase == Phase.QUESTION && !g.state.paused && g.remainingMs(serverNow()) == 0L) {
                    commit(g.close(serverNow()))
                }
            }
        }
    }

    /** Recopie l'état du moteur dans l'état de l'écran. */
    private fun refresh() {
        val g = game ?: return
        val s = g.state
        val q = g.question
        val revealedAwards = q?.let { s.awards[it.id] }.orEmpty()
        _state.update { cur ->
            if (cur !is UiState.Playing) cur
            else cur.copy(
                phase = s.phase,
                question = q.takeIf { s.phase != Phase.LOBBY },
                index = s.index,
                total = g.quiz.questions.size,
                paused = s.paused,
                pauseReason = s.hold?.reason,
                resumeAt = s.resumeAt,
                deadline = g.deadline(),
                remainingMs = q?.let { it.durationMs - s.elapsedAt(Long.MAX_VALUE) }?.coerceAtLeast(0) ?: 0,
                awards = revealedAwards,
                scores = s.scores(),
                lastGain = revealedAwards.mapValues { it.value.points },
                isLast = g.isLastQuestion,
            )
        }
        watchAnswers(s.qid.takeIf { s.phase == Phase.QUESTION || s.phase == Phase.CLOSED })
    }

    // ---------- Régie (téléphone de l'animatrice) ----------

    fun showRegie() = updatePlaying { it.copy(showRegie = true) }
    fun hideRegie() = updatePlaying { it.copy(showRegie = false) }

    /** Retire toutes les régies et change le code : les anciens téléphones ne pilotent plus. */
    fun removeRegies() {
        val s = _state.value as? UiState.Playing ?: return
        if (regieUids.isNotEmpty()) gameRef?.updateChildren(regieUids.associate { "regie/$it" to null })
        updatePlaying { it.copy(regiePin = newPin(s.code)) }
    }

    private fun regiePin(code: String): String = prefs.getString("regie_pin_$code", null) ?: newPin(code)

    private fun newPin(code: String): String {
        val pin = "%04d".format(SecureRandom().nextInt(10_000))
        prefs.edit().putString("regie_pin_$code", pin).commit()
        return pin
    }

    /**
     * Code de secours (le chemin normal est le mot de passe commun, vérifié par les règles Firebase) :
     * la box compare le code (il n'est jamais écrit dans Firebase), limite les essais
     * (5 erreurs = 60 s de blocage), puis efface la demande et publie le verdict.
     */
    private fun judgePairing(req: DataSnapshot) {
        val uid = req.key ?: return
        val s = _state.value as? UiState.Playing ?: return
        if (!judging.add(uid)) return
        val now = serverNow()
        val status = when {
            uid in regieUids -> "ok"
            regieUids.size >= MAX_REGIES -> "full"
            now < pinLockedUntil -> "locked"
            req.child("pin").getValue(String::class.java) == s.regiePin -> "ok".also { pinFailures = 0 }
            ++pinFailures >= MAX_PIN_FAILURES -> "locked".also { pinFailures = 0; pinLockedUntil = now + PIN_LOCK_MS }
            else -> "wrong"
        }
        val updates = mutableMapOf<String, Any?>(
            "pairing/$uid" to null,
            "pairingResult/$uid" to mapOf("status" to status, "at" to ServerValue.TIMESTAMP),
            "pairingLock" to mapOf("failures" to pinFailures, "until" to pinLockedUntil),
        )
        if (status == "ok" && uid !in regieUids) {
            updates["regie/$uid"] = mapOf("pairedAt" to ServerValue.TIMESTAMP, "via" to "pin")
        }
        gameRef?.updateChildren(updates)?.addOnCompleteListener { judging.remove(uid) }
    }

    /**
     * Prestation choisie sur la régie (salon d'attente seulement) : la box vérifie le quiz, remplace
     * celui de la partie, republie le conducteur et répond dans showStatus/. Le journal est gardé
     * (corrections de score déjà faites), aucune question n'a encore été jouée.
     */
    private fun judgeShow(snap: DataSnapshot) {
        val id = snap.child("id").getValue(String::class.java) ?: return
        if (id == judgedShow) return
        viewModelScope.launch { actions.withLock {
            if (id == judgedShow) return@withLock
            val g = game ?: return@withLock
            judgedShow = id
            val quiz = runCatching { QuizJson.fromValue(snap.child("quiz").value) }
            val reason = when {
                g.state.phase != Phase.LOBBY || g.state.index >= 0 -> "not_now"
                quiz.isFailure -> "invalid".also { Log.e(TAG, "Prestation refusée", quiz.exceptionOrNull()) }
                else -> null
            }
            if (reason == null) {
                val q = quiz.getOrThrow()
                game = Game(q, g.events)
                updatePlaying {
                    it.copy(title = q.title, childName = snap.child("childName").getValue(String::class.java).orEmpty())
                }
                gameRef?.child("conducteur")?.setValue(conducteur(q))
                publishPublic()
                publishState()
                refresh()
            }
            gameRef?.child("showStatus")?.setValue(
                clean(mapOf("id" to id, "status" to if (reason == null) "applied" else "refused", "reason" to reason, "at" to ServerValue.TIMESTAMP))
            )
        } }
    }

    /** Titre et prénom de l'enfant fêté, lisibles par les pupitres pour l'accueil. */
    private fun publishPublic() {
        val s = _state.value as? UiState.Playing ?: return
        val title = s.title.ifBlank { game?.quiz?.title.orEmpty() }
        gameRef?.child("public")?.setValue(clean(mapOf("title" to title.take(120), "childName" to s.childName.take(40).ifBlank { null })))
    }

    /** Les commandes arrivent dans l'ordre de leurs clés et passent une par une, comme les boutons de la box. */
    private fun listenCommands(ref: DatabaseReference) {
        val commands = ref.child("commands")
        val listener = object : ChildEventListener {
            override fun onChildAdded(snapshot: DataSnapshot, previousChildName: String?) = onCommand(snapshot)
            override fun onChildChanged(snapshot: DataSnapshot, previousChildName: String?) = Unit
            override fun onChildRemoved(snapshot: DataSnapshot) = Unit
            override fun onChildMoved(snapshot: DataSnapshot, previousChildName: String?) = Unit
            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Commandes : ${error.message}")
            }
        }
        commands.addChildEventListener(listener)
        commandsListener = commands to listener
    }

    private fun onCommand(snap: DataSnapshot) {
        val id = snap.key ?: return
        if (!handledCommands.add(id)) return
        val cmd = (snap.value as? Map<*, *>)?.let { Command.decode(id, it) }
        viewModelScope.launch { actions.withLock {
            val g = game ?: return@withLock
            if (cmd == null) {
                gameRef?.updateChildren(statusOf(id, CommandResult(CommandStatus.REFUSED, reason = "invalid")))
                return@withLock
            }
            val answers = if (cmd is Command.Next && g.state.phase == Phase.CLOSED) collectAnswers() else emptyMap()
            val result = g.execute(cmd, serverNow(), teams().map { it.uid }.toSet(), answers)
            if (result.event != null) commit(result.event, statusOf(id, result))
            else gameRef?.updateChildren(statusOf(id, result))
        } }
    }

    private fun statusOf(id: String, r: CommandResult): Map<String, Any?> = mapOf(
        "commandStatus/$id" to clean(
            mapOf("status" to r.status.code, "reason" to r.reason, "seq" to r.event?.seq, "at" to ServerValue.TIMESTAMP)
        ),
    )

    // ---------- Firebase ----------

    private suspend fun connect(): FirebaseDatabase {
        // FirebaseApp est initialisé automatiquement à partir de google-services.json.
        val auth = FirebaseAuth.getInstance()
        if (auth.currentUser == null) auth.signInAnonymously().await()
        val db = FirebaseDatabase.getInstance(databaseUrl()).also { db ->
            // Copie locale sur la box : les données restent lisibles si Internet coupe.
            if (!persistenceOn) {
                runCatching { db.setPersistenceEnabled(true) }
                persistenceOn = true
            }
        }
        CrashReporter.upload(getApplication<Application>(), db)
        return db
    }

    private suspend fun createGame(db: FirebaseDatabase, uid: String): String {
        repeat(8) {
            val code = (1..5).map { CODE_CHARS.random() }.joinToString("")
            val ref = db.getReference("games/$code")
            // Seul `hostUid` est lisible avant d'être l'hôte : il suffit pour savoir si le code est pris.
            // Base muette deux fois de suite : inutile d'essayer d'autres codes.
            val taken = ref.child("hostUid").readOnce() ?: ref.child("hostUid").readOnce()
                ?: error("La base Firebase ne répond pas. Vérifiez Internet puis réessayez.")
            if (!taken.exists()) {
                val g = Game(loadQuiz(DEFAULT_QUIZ))
                ref.setValue(
                    mapOf(
                        "hostUid" to uid,
                        "createdAt" to ServerValue.TIMESTAMP,
                        "quizId" to g.quiz.id,
                        "appVersion" to BuildConfig.VERSION_NAME,
                        "state" to clean(Codec.publicState(g)),
                    )
                ).await()
                return code
            }
        }
        error("Impossible de créer une partie")
    }

    private fun listenGame(db: FirebaseDatabase, ref: DatabaseReference) {
        observe(db.getReference(".info/serverTimeOffset")) { snap ->
            serverOffset = (snap.value as? Number)?.toLong() ?: 0L
            updatePlaying { it.copy(serverOffset = serverOffset) }
        }
        observe(db.getReference(".info/connected")) { snap ->
            val connected = snap.getValue(Boolean::class.java) == true
            updatePlaying { it.copy(connected = connected) }
        }
        observe(ref.child("teams")) { snap ->
            val teams = parseTeams(snap)
            updatePlaying { s ->
                if (teams.size > s.teams.size) tones?.startTone(ToneGenerator.TONE_PROP_BEEP2, 200)
                s.copy(teams = teams)
            }
        }
        online = emptySet()
        observe(ref.child("presence")) { snap ->
            val now = snap.children.filter { it.child("online").getValue(Boolean::class.java) == true }
                .mapNotNull { it.key }.toSet()
            onPresence(online, now)
            online = now
            updatePlaying { it.copy(online = now) }
        }
        observe(ref.child("buzz")) { snap ->
            updatePlaying { s ->
                val buzzerUid = snap.child("${s.round}/team").getValue(String::class.java)
                if (buzzerUid != null && s.buzzerUid == null) {
                    tones?.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 600)
                }
                s.copy(buzzerUid = buzzerUid)
            }
        }
        observe(ref.child("pairing")) { snap -> snap.children.forEach(::judgePairing) }
        observe(ref.child("show"), ::judgeShow)
        observe(ref.child("regie")) { snap ->
            val uids = snap.children.mapNotNull { it.key }.toSet()
            val added = uids - regieUids
            regieUids = uids
            // Une régie vient d'être reliée : on referme l'écran du QR code.
            updatePlaying { it.copy(regies = uids.size, showRegie = it.showRegie && added.isEmpty()) }
        }
    }

    /**
     * Un pupitre qui décroche en pleine question met la partie en pause pour ne défavoriser personne.
     * Délai de grâce : un rechargement de page ou une micro-coupure ne déclenche rien. Seule la
     * transition connecté → déconnecté compte : après la reprise, une équipe absente ne rebloque pas la partie.
     */
    private fun onPresence(before: Set<String>, now: Set<String>) {
        (now - before).forEach { dropTimers.remove(it)?.cancel() }
        (before - now).forEach { uid ->
            dropTimers.remove(uid)?.cancel()
            dropTimers[uid] = viewModelScope.launch {
                delay(DROP_GRACE_MS)
                dropTimers.remove(uid)
                act { g ->
                    val waited = g.state.phase == Phase.QUESTION && !g.state.paused && g.remainingMs(serverNow()) > 0
                    if (waited && uid !in online && uid !in answers && teams().any { it.uid == uid }) {
                        g.pause(serverNow(), PAUSE_TEAM, uid)
                    } else null
                }
            }
        }
    }

    private fun parseTeams(snap: DataSnapshot): List<Team> = snap.children.mapNotNull { t ->
        val name = t.child("name").getValue(String::class.java) ?: return@mapNotNull null
        Team(
            uid = t.key!!,
            name = name,
            color = t.child("color").getValue(String::class.java) ?: "#FF3CAC",
            joinedAt = t.child("joinedAt").getValue(Long::class.java) ?: 0L,
        )
    }.sortedBy { it.joinedAt }.take(MAX_TEAMS)

    /** Suit les réponses de la question en cours (pour l'affichage « a répondu » et la fermeture anticipée). */
    private fun watchAnswers(qid: String?) {
        val current = answersListener?.first?.key
        if (qid == current) return
        answersListener?.let { (r, l) -> r.removeEventListener(l) }
        answersListener = null
        answers = emptyMap()
        updatePlaying { it.copy(answered = emptySet()) }
        val ref = gameRef?.child("answers")?.child(qid ?: return) ?: return
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val before = answers.size
                answers = parseAnswers(snapshot)
                if (answers.size > before) tones?.startTone(ToneGenerator.TONE_PROP_ACK, 120)
                updatePlaying { it.copy(answered = answers.keys) }
                closeIfEveryoneAnswered()
            }

            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Réponses : ${error.message}")
            }
        }
        ref.addValueEventListener(listener)
        answersListener = ref to listener
    }

    private fun closeIfEveryoneAnswered() {
        val teams = teams().map { it.uid }
        if (teams.isEmpty() || !answers.keys.containsAll(teams)) return
        act { g -> if (g.state.phase == Phase.QUESTION && !g.state.paused) g.close(serverNow()) else null }
    }

    private fun parseAnswers(snap: DataSnapshot): Map<String, Answer> = snap.children.mapNotNull { a ->
        val choice = a.child("choice").getValue(Int::class.java) ?: return@mapNotNull null
        val at = a.child("at").getValue(Long::class.java) ?: return@mapNotNull null
        a.key!! to Answer(choice, at)
    }.toMap()

    private fun updatePlaying(transform: (UiState.Playing) -> UiState.Playing) {
        _state.update { s -> if (s is UiState.Playing) transform(s) else s }
    }

    private fun observe(ref: DatabaseReference, onData: (DataSnapshot) -> Unit) {
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) = onData(snapshot)
            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Lecture refusée ${ref.path} : ${error.message}")
            }
        }
        ref.addValueEventListener(listener)
        listeners += ref to listener
    }

    private fun stopListening() {
        dropTimers.values.forEach { it.cancel() }
        dropTimers.clear()
        listeners.forEach { (ref, l) -> ref.removeEventListener(l) }
        listeners.clear()
        answersListener?.let { (r, l) -> r.removeEventListener(l) }
        answersListener = null
        commandsListener?.let { (r, l) -> r.removeEventListener(l) }
        commandsListener = null
        judging.clear()
    }

    /** Un bip par seconde du décompte 3, 2, 1, puis un plus aigu au départ. */
    private fun countdownBeeps(event: Resumed) {
        viewModelScope.launch {
            val steps = (event.countdownMs / 1000).toInt()
            for (i in 0 until steps) {
                delay((event.at + i * 1000L - serverNow()).coerceAtLeast(0))
                tones?.startTone(ToneGenerator.TONE_PROP_BEEP, 150)
            }
            delay((event.at + event.countdownMs - serverNow()).coerceAtLeast(0))
            tones?.startTone(ToneGenerator.TONE_PROP_BEEP2, 300)
        }
    }

    private fun sound(phase: Phase) {
        val tone = when (phase) {
            Phase.QUESTION -> ToneGenerator.TONE_PROP_BEEP
            Phase.CLOSED -> ToneGenerator.TONE_PROP_NACK
            Phase.REVEAL -> ToneGenerator.TONE_CDMA_CONFIRM
            Phase.ENDED -> ToneGenerator.TONE_CDMA_ABBR_ALERT
            else -> return
        }
        tones?.startTone(tone, 300)
    }

    override fun onCleared() {
        stopListening()
        tones?.release()
    }

    companion object {
        private const val TAG = "Partie"
        private var persistenceOn = false
        const val AUTO_RESUME_SECONDS = 15
        const val MAX_TEAMS = 8
        const val MAX_REGIES = 2
        private const val MAX_PIN_FAILURES = 5
        private const val PIN_LOCK_MS = 60_000L
        private const val DEFAULT_QUIZ = "demo"

        /** Délai laissé aux réponses envoyées à la dernière seconde avant de fermer la question. */
        private const val CLOSE_GRACE_MS = 500L

        /** Temps laissé à un pupitre déconnecté pour revenir seul avant la pause automatique. */
        private const val DROP_GRACE_MS = 4000L

        /** Deux appuis sur OK plus rapprochés que cela ne font avancer que d'une étape. */
        private const val NEXT_GUARD_MS = 500L
        private const val CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

        fun joinUrl(code: String) = "https://${BuildConfig.FB_PROJECT_ID}.web.app/?g=$code"

        /** Ce que la régie consulte : toutes les questions, avec leur bonne réponse. */
        fun conducteur(quiz: Quiz): Map<String, Any> = mapOf(
            "title" to quiz.title,
            "questions" to quiz.questions.map {
                clean(mapOf("text" to it.text, "choices" to it.choices, "correct" to it.correct, "double" to it.double, "round" to it.roundTitle))
            },
        )

        fun databaseUrl(): String = BuildConfig.FB_DATABASE_URL.ifBlank {
            "https://${BuildConfig.FB_PROJECT_ID}-default-rtdb.europe-west1.firebasedatabase.app"
        }

        /** Firebase n'accepte pas les valeurs nulles dans une écriture : on les retire. */
        fun clean(m: Map<String, Any?>): Map<String, Any> = m.entries.mapNotNull { (k, v) ->
            when (v) {
                null -> null
                is Map<*, *> -> @Suppress("UNCHECKED_CAST") (k to clean(v as Map<String, Any?>))
                else -> k to v
            }
        }.toMap()
    }
}

/**
 * Lecture unique avec écouteur, bornée dans le temps (null si la base ne répond pas).
 * `get()` peut ne jamais se terminer quand la persistance locale est activée et que l'appli est
 * relancée sans que le processus Android soit tué (sortie par Retour, nouvelle partie).
 */
private suspend fun DatabaseReference.readOnce(timeoutMs: Long = 8000L): DataSnapshot? = withTimeoutOrNull(timeoutMs) {
    suspendCancellableCoroutine { cont ->
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                if (cont.isActive) cont.resume(snapshot)
            }

            override fun onCancelled(error: DatabaseError) {
                if (cont.isActive) cont.resumeWithException(error.toException())
            }
        }
        addListenerForSingleValueEvent(listener)
        cont.invokeOnCancellation { removeEventListener(listener) }
    }
}
