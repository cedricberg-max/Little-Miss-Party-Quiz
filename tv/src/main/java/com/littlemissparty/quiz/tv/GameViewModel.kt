package com.littlemissparty.quiz.tv

import android.app.Application
import android.content.Context
import android.os.SystemClock
import android.util.Base64
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
import com.littlemissparty.quiz.engine.Jumped
import com.littlemissparty.quiz.engine.QuestionOpened
import com.littlemissparty.quiz.engine.MimeCard
import com.littlemissparty.quiz.engine.MimeTurn
import com.littlemissparty.quiz.engine.Scoring
import com.littlemissparty.quiz.engine.PAUSE_TEAM
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.engine.Quiz
import com.littlemissparty.quiz.engine.QuizJson
import com.littlemissparty.quiz.engine.execute
import com.littlemissparty.quiz.engine.programProblem
import com.littlemissparty.quiz.engine.withProgram
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

/** [uid] identifie l'équipe (l'appareil qui l'a créée) ; [device] est l'appareil qui le remplace, s'il y en a un. */
data class Team(val uid: String, val name: String, val color: String, val joinedAt: Long, val device: String? = null)

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
        /** Buzzer de l'accueil, pour s'amuser : nombre d'appuis vus par équipe et dernière équipe qui a buzzé. */
        val funBuzzes: Map<String, Int> = emptyMap(),
        val lastFunBuzz: String? = null,
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
        /** Manche de mimes en cours (ou qui vient de finir, au classement), sinon null. */
        val mime: MimeUi? = null,
        /** Photos d'illustration déjà chargées (identifiant → fichier JPEG), montrées à la révélation. */
        val images: Map<String, ByteArray> = emptyMap(),
        /** Image floue : équipe qui a buzzé et attend le verdict (null sinon), équipes bloquées sur cette image. */
        val buzzTeam: String? = null,
        val buzzBlocked: List<String> = emptyList(),
        /**
         * Extraits musicaux déjà dans le cache de la box (identifiant → fichier MP3 local) : blind test et quiz
         * musical les jouent depuis ce fichier, jamais en streaming. Absent : la question se joue sans musique.
         */
        val sounds: Map<String, String> = emptyMap(),
    ) : UiState {
        /** Total des appuis sur le buzzer de l'accueil, pour le son. */
        val funTotal: Int get() = funBuzzes.values.sum()
        val ranking: List<Pair<Team, Int>>
            get() = teams.map { it to (scores[it.uid] ?: 0) }.sortedWith(compareByDescending<Pair<Team, Int>> { it.second }.thenBy { it.first.joinedAt })
    }
}

/**
 * Mimes vus par l'écran : équipe qui joue (null entre deux tours), carte affichée, compteurs du tour,
 * bilan du dernier tour, mimes trouvés par équipe dans la manche et équipes ayant déjà joué.
 */
data class MimeUi(
    val team: String? = null,
    val card: MimeCard? = null,
    val found: Int = 0,
    val passed: Int = 0,
    val left: Int = 0,
    val last: MimeTurn? = null,
    val counts: Map<String, Int> = emptyMap(),
    val turns: List<String> = emptyList(),
)

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
    private var buzzListener: Pair<DatabaseReference, ValueEventListener>? = null
    private var answers: Map<String, Answer> = emptyMap()
    private var countdown: Job? = null
    private var timer: Job? = null
    private var expressTimer: Job? = null
    private var armTimer: Job? = null
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
    /**
     * Version du programme en vigueur (prestation ou modification acceptée), publiée dans le conducteur.
     * Une modification préparée sur une autre version est refusée : deux téléphones ne se marchent pas dessus.
     */
    private var programRev: String = "initial"
    /** Pupitres connectés au dernier relevé, et pupitres tout juste décrochés (délai de grâce en cours). */
    private var online: Set<String> = emptySet()
    private var funSeen: Map<String, Long>? = null
    private val dropTimers = mutableMapOf<String, Job>()
    /** Surveillance de la coupure Internet de la box (pause automatique d'une question en cours). */
    private var offlineWatch: Job? = null
    /** Dernier appui sur OK pris en compte (anti double appui). */
    private var lastNextAt = -NEXT_GUARD_MS
    private val prefs = app.getSharedPreferences("partie", Context.MODE_PRIVATE)

    /** Code de la partie en cours, mémorisé sur la box pour survivre à un crash ou un redémarrage. */
    private var activeCode: String?
        get() = prefs.getString("active_game", null)
        set(value) {
            prefs.edit().apply { if (value == null) remove("active_game") else putString("active_game", value) }.commit()
        }

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
        expressTimer?.cancel()
        armTimer?.cancel()
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
        expressTimer?.cancel()
        armTimer?.cancel()
        val ref = db.getReference("games/$code")
        gameRef = ref
        activeCode = code
        val snap = ref.readOnce() ?: error("La base Firebase ne répond pas. Vérifiez Internet puis réessayez.")
        // Programme en vigueur, écrit par la box elle-même (prestation et modifications acceptées) ;
        // à défaut (partie d'une version plus ancienne), la prestation chargée par la régie et acceptée.
        val program = snap.child("conducteur").takeIf { it.child("id").value != null && it.child("rev").value != null }
            ?.let { c -> runCatching { QuizJson.fromValue(c.value) }.getOrNull()?.let { it to c.child("rev").getValue(String::class.java)!! } }
        val show = snap.child("show")
        val showApplied = show.child("id").value != null &&
            snap.child("showStatus/id").value == show.child("id").value &&
            snap.child("showStatus/status").getValue(String::class.java) == "applied"
        val quiz = program?.first
            ?: (if (showApplied) runCatching { QuizJson.fromValue(show.child("quiz").value) }.getOrNull() else null)
            ?: loadQuiz(snap.child("quizId").getValue(String::class.java))
        programRev = program?.second ?: if (showApplied) show.child("id").getValue(String::class.java)!! else "initial"
        val named = program != null || showApplied
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
            title = if (named) quiz.title else "",
            childName = if (named) snap.child("public/childName").getValue(String::class.java)
                ?: show.child("childName").getValue(String::class.java).orEmpty() else "",
        )
        // Le conducteur (questions et bonnes réponses) n'est lisible que par les régies reliées.
        ref.child("conducteur").setValue(conducteur(quiz, programRev))
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
            // Décompte 3, 2, 1 en cours : un second appui sur « Reprendre » ne fait pas avancer la partie.
            if (g.state.resumeAt?.let { serverNow() < it } == true) return@withLock
            when (g.state.phase) {
                Phase.LOBBY -> if (teams().isNotEmpty()) commit(g.next(serverNow()))
                // Mimes : arrête le tour en cours, ou termine la manche entre deux tours (« Terminer les mimes »).
                Phase.QUESTION -> if (g.question?.isMime == true) commit(g.next(serverNow()))
                // Chrono qui vient de partir : second appui d'un double clic, même livré en retard par la box.
                else if (!g.justStarted(serverNow())) commit(g.close(serverNow()))
                Phase.CLOSED -> commit(g.reveal(serverNow(), collectAnswers()))
                else -> commit(g.next(serverNow()))
            }
        } }
    }

    fun togglePause() = act { g -> if (g.state.paused) g.resume(serverNow()) else g.pause(serverNow()) }

    /** Mimes à la télécommande : lancer le tour de [team] (null : l'équipe qui a le moins joué). */
    fun mimeStart(team: String?) = act { g -> (team ?: g.nextMimeTeam(teams().map { it.uid }))?.let { g.mimeStart(it, serverNow()) } }

    /**
     * Mime trouvé à la télécommande. Un appui juste après « Top départ » est le second appui d'un double clic
     * sur OK (le bouton « Trouvé » vient de prendre le focus) : il ne compte pas.
     */
    fun mimeFound() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastNextAt < NEXT_GUARD_MS) return
        lastNextAt = now
        act { g -> if (g.justStarted(serverNow())) null else g.mimeFound(serverNow()) }
    }

    fun mimePass() = act { it.mimePass(serverNow()) }

    /** Image floue à la télécommande (secours de la régie) : verdict sur la réponse orale de l'équipe qui a buzzé. */
    fun judgeBuzz(ok: Boolean, bonus: Boolean = false) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastNextAt < NEXT_GUARD_MS) return
        lastNextAt = now
        act { it.judgeBuzz(ok, serverNow(), bonus) }
    }
    fun mimeStop() = act { it.mimeStop(serverNow()) }
    fun pause() = act { it.pause(serverNow()) }
    fun unpause() = act { it.resume(serverNow()) }

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
        // Jeu rejoué depuis la régie : ses anciennes réponses sont effacées, les pupitres peuvent répondre à nouveau.
        val replayed = (event as? Jumped)?.clear.orEmpty().associate { "answers/$it" to null } +
            // Question ouverte : ses anciennes réponses (jeu déjà joué puis repris plus tôt dans le programme)
            // sont effacées, sinon les règles refuseraient les nouvelles et la question ne rapporterait rien.
            ((event as? QuestionOpened)?.let { mapOf("answers/${it.qid}" to null) } ?: emptyMap())
        // Sans réseau, Firebase garde l'écriture en file d'attente et l'envoie au retour de la connexion.
        ref.updateChildren(
            mapOf(
                "log/${Codec.key(event.seq)}" to clean(Codec.encode(event)),
                "state" to clean(Codec.publicState(g, round)),
            ) + replayed + extra
        ).addOnFailureListener { Log.e(TAG, "Écriture refusée", it) }
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

    /** Ferme automatiquement la question à la fin du chrono ; au Vrai ou Faux express, enchaîne aussi la suite. */
    private fun schedule() {
        timer?.cancel()
        scheduleExpress()
        scheduleArm()
        val g = game ?: return
        val deadline = g.deadline() ?: return
        timer = viewModelScope.launch {
            delay((deadline - serverNow() + CLOSE_GRACE_MS).coerceAtLeast(0))
            actions.withLock {
                if (g.state.phase == Phase.QUESTION && !g.state.paused && g.remainingMs(serverNow()) == 0L) {
                    // Fin de la question, ou fin du tour de mimes.
                    commit(g.timeUp(serverNow()))
                }
            }
        }
    }

    /**
     * Qui a disparu ? : ouvre le buzzer quand le chrono a dépassé la mémorisation. Une pause repousse
     * l'ouverture (la minuterie repart à chaque changement de la partie) ; un réveil trop tôt (décompte
     * 3, 2, 1 d'une reprise) attend encore un peu.
     */
    private fun scheduleArm() {
        armTimer?.cancel()
        val g = game ?: return
        if (g.armDelayMs(serverNow()) == null) return
        armTimer = viewModelScope.launch {
            while (true) {
                val wait = g.armDelayMs(serverNow()) ?: return@launch
                delay(wait.coerceAtLeast(100))
                // Ouvert : commit relance les minuteries, dont celle-ci qui n'a alors plus rien à attendre.
                actions.withLock { if (game === g) commit(g.armBuzz(serverNow())) }
                if (game !== g) return@launch
            }
        }
    }

    /**
     * Vrai ou Faux express : révélation peu après la fermeture, puis affirmation suivante. L'étape est
     * oubliée si la partie a bougé entre-temps (animatrice, régie, pause) : rien n'avance deux fois.
     */
    private fun scheduleExpress() {
        expressTimer?.cancel()
        val g = game ?: return
        val wait = g.expressDelayMs() ?: return
        val seq = g.state.lastSeq
        expressTimer = viewModelScope.launch {
            delay(wait)
            actions.withLock {
                if (game !== g || g.state.lastSeq != seq) return@withLock
                val answers = if (g.state.phase == Phase.CLOSED) collectAnswers() else emptyMap()
                commit(g.expressStep(serverNow(), answers))
            }
        }
    }

    /** Recopie l'état du moteur dans l'état de l'écran. */
    private fun refresh() {
        val g = game ?: return
        val s = g.state
        val q = g.question
        val revealedAwards = q?.let { s.awards[it.id] }.orEmpty()
        val mimeCounts = q?.takeIf { it.isMime }?.let { s.mimes[it.id] }.orEmpty()
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
                buzzTeam = s.buzz?.team,
                buzzBlocked = s.buzz?.blocked.orEmpty(),
                lastGain = if (q?.isMime == true) mimeCounts.mapValues { it.value * Scoring.MIME } else revealedAwards.mapValues { it.value.points },
                isLast = g.isLastQuestion,
                mime = q?.takeIf { it.isMime && s.phase != Phase.LOBBY }?.let {
                    val m = s.mime
                    MimeUi(
                        team = m?.team, card = g.mimeCard, found = m?.found ?: 0, passed = m?.passed ?: 0,
                        left = m?.deck?.size ?: 0, last = m?.last, counts = mimeCounts, turns = m?.turns.orEmpty(),
                    )
                },
            )
        }
        watchAnswers(s.qid.takeIf { s.phase == Phase.QUESTION || s.phase == Phase.CLOSED })
        // Image floue : on écoute le buzzer de cet essai ; toutes les équipes bloquées, l'image se ferme.
        watchBuzz(Codec.buzzKey(g)?.takeIf { !s.buzzHeld && !s.paused })
        val blocked = s.buzz?.blocked.orEmpty()
        val teamIds = teams().map { it.uid }
        if (s.phase == Phase.QUESTION && !s.paused && !s.buzzHeld && teamIds.isNotEmpty() && blocked.containsAll(teamIds)) {
            act { it.takeIf { g -> g.state.phase == Phase.QUESTION && g.state.buzz?.blocked.orEmpty().containsAll(teamIds) }?.close(serverNow()) }
        }
        // Photo de la question en cours et de la suivante chargées d'avance (dès le salon d'attente pour la
        // première) : la révélation, ou le Zoom mystère, ne l'attend jamais.
        listOfNotNull(q?.imageId.takeIf { s.phase != Phase.LOBBY }, g.quiz.questions.getOrNull(s.index + 1)?.imageId).forEach(::prefetchImage)
        // Extraits musicaux : tous ceux du programme, dès son chargement, pour que la musique ne dépende
        // plus du réseau une fois la partie lancée.
        g.quiz.questions.mapNotNullTo(LinkedHashSet()) { it.audioId }.forEach(::prefetchSound)
    }

    private val soundFiles = mutableMapOf<String, String>()
    private val SOUND_TRIES = 3
    private val SOUND_RETRY_MS = 3_000L
    private val soundsLoading = mutableSetOf<String>()

    /**
     * Copie un extrait musical de la partie dans le cache de la box (filesDir/extraits/<empreinte>.mp3).
     * Le fichier est vérifié par son empreinte avant d'être gardé ; déjà là (partie précédente, redémarrage),
     * il n'est pas retéléchargé. Absent, abîmé ou hors connexion : la question se jouera sans musique.
     */
    private fun prefetchSound(id: String) {
        if (id in soundFiles) {
            // Nouvelle partie sur la même box : l'extrait déjà en cache est remis dans l'état de l'écran.
            if ((_state.value as? UiState.Playing)?.sounds?.containsKey(id) == false) updatePlaying { it.copy(sounds = soundFiles.toMap()) }
            return
        }
        if (!soundsLoading.add(id)) return
        val dir = java.io.File(getApplication<Application>().filesDir, "extraits")
        val file = java.io.File(dir, "$id.mp3")
        if (file.isFile && file.length() > 0) return publishSound(id, file)
        val ref = gameRef ?: return run { soundsLoading -= id }
        viewModelScope.launch {
            // La régie copie les extraits pendant que la TV reçoit le programme : on attend qu'ils arrivent.
            repeat(SOUND_TRIES) { attempt ->
                val ok = runCatching {
                    val data = ref.child("sounds/$id").readWhenPresent()?.getValue(String::class.java) ?: return@runCatching false
                    if (!Extraits.empreinteOk(id, data)) return@runCatching false
                    val bytes = Base64.decode(data.substringAfter("base64,", ""), Base64.DEFAULT)
                    if (bytes.isEmpty()) return@runCatching false
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                        dir.mkdirs()
                        val part = java.io.File(dir, "$id.part")
                        part.writeBytes(bytes)
                        part.renameTo(file)
                    }
                }.getOrDefault(false)
                if (ok && file.isFile) return@launch publishSound(id, file)
                if (gameRef != ref) { soundsLoading -= id; return@launch }
                if (attempt < SOUND_TRIES - 1) delay(SOUND_RETRY_MS)
            }
            soundsLoading -= id
        }
    }

    private fun publishSound(id: String, file: java.io.File) {
        soundsLoading -= id
        soundFiles[id] = file.absolutePath
        updatePlaying { it.copy(sounds = soundFiles.toMap()) }
    }

    private val imageBytes = object : LinkedHashMap<String, ByteArray>(8, 0.75f, true) {
        // Quelques photos seulement en mémoire : la box ancienne a peu de place.
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ByteArray>?) = size > 4
    }
    private val imagesLoading = mutableSetOf<String>()

    /** Lit une photo d'illustration dans la partie ; absente, abîmée ou hors connexion : la question reste sans photo. */
    private fun prefetchImage(id: String) {
        if (id in imageBytes || !imagesLoading.add(id)) return
        val ref = gameRef ?: return run { imagesLoading -= id }
        viewModelScope.launch {
            val bytes = runCatching {
                // Attente de la copie par la régie : une lecture unique pourrait renvoyer « absente » depuis le cache.
                val data = ref.child("images/$id").readWhenPresent(PHOTO_WAIT_MS)?.getValue(String::class.java)
                data?.substringAfter("base64,", "")?.takeIf { it.isNotEmpty() }?.let { Base64.decode(it, Base64.DEFAULT) }
            }.getOrNull()
            imagesLoading -= id
            if (bytes == null) return@launch
            imageBytes[id] = bytes
            updatePlaying { it.copy(images = imageBytes.toMap()) }
        }
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
     * Prestation choisie sur la régie, ou programme modifié en cours de partie (jeu ajouté, manches futures
     * déplacées ou retirées). La box vérifie le quiz, remplace celui de la partie, republie le conducteur et
     * répond dans showStatus/. Le journal est gardé tel quel : équipes, scores et progression ne bougent pas.
     * - Sans `base` : une prestation complète, seulement au salon d'attente, avant toute question.
     * - Avec `base` : une modification préparée sur le programme [programRev] ; la question et la manche en
     *   cours ne changent jamais ([programProblem]).
     */
    private fun judgeShow(snap: DataSnapshot) {
        val id = snap.child("id").getValue(String::class.java) ?: return
        if (id == judgedShow) return
        viewModelScope.launch { actions.withLock {
            if (id == judgedShow) return@withLock
            val g = game ?: return@withLock
            judgedShow = id
            val base = snap.child("base").getValue(String::class.java)
            val quiz = runCatching { QuizJson.fromValue(snap.child("quiz").value) }
            val lobby = g.state.phase == Phase.LOBBY && g.state.index < 0
            val q = quiz.getOrNull()
            var reason = when {
                quiz.isFailure -> "invalid".also { Log.e(TAG, "Prestation refusée", quiz.exceptionOrNull()) }
                base == null && !lobby -> "not_now"
                base != null && base != programRev -> "stale"
                base != null -> g.programProblem(q!!)
                else -> null
            }
            val next = if (reason == null) (if (base == null) Game(q!!, g.events) else g.withProgram(q!!)) else null
            if (reason == null && next == null) reason = "invalid"
            if (next != null) {
                game = next
                programRev = id
                updatePlaying {
                    if (base == null) it.copy(title = q!!.title, childName = snap.child("childName").getValue(String::class.java).orEmpty())
                    else it
                }
                gameRef?.child("conducteur")?.setValue(conducteur(next.quiz, programRev))
                publishPublic()
                publishState()
                refresh()
                // Le chrono en cours était surveillé sur l'ancienne partie : on le reprend sur la nouvelle.
                schedule()
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
        val type = snap.child("type").getValue(String::class.java)
        if (type == ADMIT || type == REPLACE) {
            viewModelScope.launch { actions.withLock { admitDevice(id, replace = type == REPLACE, cmd = snap) } }
            return
        }
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

    /**
     * Appareil arrivé en cours de partie, accepté par la régie : nouvelle équipe, ou remplaçant d'une équipe
     * existante, qui garde son nom, sa couleur et ses points (ils sont rangés sous l'identifiant de l'équipe).
     * Les règles Firebase n'acceptent plus rien de l'ancien appareil. La demande est effacée dans la même écriture.
     */
    private suspend fun admitDevice(id: String, replace: Boolean, cmd: DataSnapshot) {
        val ref = gameRef ?: return
        val device = cmd.child("device").getValue(String::class.java)
        val team = cmd.child("team").getValue(String::class.java)
        val request = device?.let { runCatching { ref.child("joinRequests/$it").readOnce() }.getOrNull() }?.takeIf { it.exists() }
        val teams = teams()
        val reason = when {
            device == null || request == null -> "gone"
            teams.any { it.uid == device || it.device == device } -> "busy"
            !replace && teams.size >= MAX_TEAMS -> "full"
            replace && teams.none { it.uid == team } -> "unknown_team"
            else -> null
        }
        val updates = mutableMapOf<String, Any?>(
            "commandStatus/$id" to clean(
                mapOf("status" to if (reason == null) "applied" else "refused", "reason" to reason, "at" to ServerValue.TIMESTAMP)
            ),
        )
        if (reason == null && device != null && request != null) {
            updates["joinRequests/$device"] = null
            if (replace) {
                updates["teams/$team/device"] = device
            } else {
                // Jamais deux équipes de la même couleur : la couleur demandée si elle est libre, sinon une autre.
                val color = freeColor(request.child("color").getValue(String::class.java), teams.map { it.color })
                updates["teams/$device"] = mapOf(
                    "name" to request.child("name").getValue(String::class.java),
                    "color" to color,
                    "joinedAt" to ServerValue.TIMESTAMP,
                )
                updates["colors/${colorKey(color)}"] = device
            }
        }
        ref.updateChildren(updates).addOnFailureListener { Log.e(TAG, "Entrée d'un appareil refusée", it) }
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
            onConnection(connected)
        }
        observe(ref.child("teams")) { snap ->
            val teams = parseTeams(snap)
            updatePlaying { s ->
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
        // Buzzer de l'accueil : chaque nouvel appui d'une équipe fait clignoter sa pastille et sonner la TV.
        // Les appuis déjà là au branchement (box qui se reconnecte) ne rejouent rien.
        funSeen = null
        observe(ref.child("fun")) { snap ->
            val now = snap.children.mapNotNull { c -> c.key?.let { it to (c.child("at").getValue(Long::class.java) ?: 0L) } }.toMap()
            val before = funSeen
            funSeen = now
            if (before == null) return@observe
            val pressed = now.filter { (uid, at) -> at > (before[uid] ?: 0L) }.keys
            if (pressed.isEmpty()) return@observe
            updatePlaying { s ->
                if (s.phase != Phase.LOBBY) s
                else s.copy(
                    funBuzzes = s.funBuzzes + pressed.associateWith { (s.funBuzzes[it] ?: 0) + 1 },
                    lastFunBuzz = pressed.maxBy { now[it] ?: 0L },
                )
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
                    // Pendant les mimes, les pupitres ne servent pas : un pupitre qui décroche ne bloque rien.
                    val waited = g.state.phase == Phase.QUESTION && !g.state.paused && g.remainingMs(serverNow()) > 0 &&
                        g.question?.isMime != true
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
            device = t.child("device").getValue(String::class.java),
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
                answers = parseAnswers(snapshot)
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

    /**
     * Image floue : le premier buzz écrit sous [key] (les règles refusent les suivants) fige l'image pour son équipe.
     * Chaque ouverture et chaque essai ont leur clé : un buzz resté en cache d'une autre fois ne compte jamais.
     */
    private fun watchBuzz(key: String?) {
        if (key == buzzListener?.first?.key) return
        buzzListener?.let { (r, l) -> r.removeEventListener(l) }
        buzzListener = null
        val ref = gameRef?.child("buzz")?.child(key ?: return) ?: return
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val team = snapshot.child("team").getValue(String::class.java) ?: return
                act { g -> if (Codec.buzzKey(g) == key && teams().any { it.uid == team }) g.buzz(team, serverNow()) else null }
            }

            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Buzzer : ${error.message}")
            }
        }
        ref.addValueEventListener(listener)
        buzzListener = ref to listener
    }

    private fun closeIfEveryoneAnswered() {
        val teams = teams().map { it.uid }
        if (teams.isEmpty() || !answers.keys.containsAll(teams)) return
        act { g -> if (g.state.phase == Phase.QUESTION && !g.state.paused) g.close(serverNow()) else null }
    }

    private fun parseAnswers(snap: DataSnapshot): Map<String, Answer> = snap.children.mapNotNull { a ->
        val choice = a.child("choice").getValue(Int::class.java) ?: return@mapNotNull null
        val at = a.child("at").getValue(Long::class.java) ?: return@mapNotNull null
        // Question rejouée : une réponse de la fois précédente (restée en cache) ne compte pas.
        if (game?.state?.answeredSinceOpening(at) == false) return@mapNotNull null
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

    /**
     * Box sans Internet : passé le délai de grâce, la question en cours se fige (pause écrite sur la box,
     * envoyée au retour du réseau). À la reconnexion, rien ne repart seul : l'animatrice relance.
     */
    private fun onConnection(connected: Boolean) {
        offlineWatch?.cancel()
        offlineWatch = null
        if (connected) return
        val since = SystemClock.elapsedRealtime()
        offlineWatch = viewModelScope.launch {
            var pausedFor: String? = null
            while (true) {
                delay(1000)
                actions.withLock {
                    val g = game ?: return@withLock
                    val event = g.networkPause(serverNow(), SystemClock.elapsedRealtime() - since, pausedFor)
                    if (event != null) {
                        pausedFor = g.state.qid
                        commit(event)
                    }
                }
            }
        }
    }

    private fun stopListening() {
        offlineWatch?.cancel()
        offlineWatch = null
        dropTimers.values.forEach { it.cancel() }
        dropTimers.clear()
        listeners.forEach { (ref, l) -> ref.removeEventListener(l) }
        listeners.clear()
        answersListener?.let { (r, l) -> r.removeEventListener(l) }
        answersListener = null
        buzzListener?.let { (r, l) -> r.removeEventListener(l) }
        buzzListener = null
        commandsListener?.let { (r, l) -> r.removeEventListener(l) }
        commandsListener = null
        judging.clear()
    }

    override fun onCleared() {
        stopListening()
    }

    companion object {
        private const val TAG = "Partie"
        private var persistenceOn = false
        const val AUTO_RESUME_SECONDS = 15
        const val MAX_TEAMS = 8
        private const val ADMIT = "admit"
        private const val REPLACE = "replace"
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
        /**
         * Programme complet en vigueur (même format qu'un quiz), lisible seulement par les régies reliées :
         * la régie l'affiche et s'en sert pour préparer une modification ; la box le relit au redémarrage.
         */
        fun conducteur(quiz: Quiz, rev: String): Map<String, Any> = mapOf(
            "id" to quiz.id,
            "title" to quiz.title,
            "rev" to rev,
            // Cette box sait jouer les mimes : la régie prévient avant d'en envoyer à une TV trop ancienne.
            "mimes" to true,
            "numbers" to true,
            "express" to true,
            "zoom" to true,
            "flou" to true,
            "chante" to true,
            "quisuis" to true,
            "blind" to true,
            "statues" to true,
            "disparu" to true,
            "questions" to quiz.questions.map {
                clean(mapOf(
                    "id" to it.id, "text" to it.text, "choices" to it.choices.ifEmpty { null }, "correct" to it.correct,
                    "duration" to it.durationSec, "kind" to it.kind.code, "double" to it.double, "round" to it.roundTitle,
                    "cards" to it.cards.ifEmpty { null }?.map { c -> clean(mapOf("word" to c.word, "image" to c.image)) },
                    "image" to it.emoji, "imageId" to it.imageId, "artist" to it.artist, "audioId" to it.audioId,
                ))
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
/**
 * Attend qu'une donnée existe (photo ou extrait que la régie est en train de copier) : écoute en continu,
 * car avec le cache local une lecture unique peut répondre « absente » alors que la copie arrive. Null au-delà
 * de [timeoutMs].
 */
private suspend fun DatabaseReference.readWhenPresent(timeoutMs: Long = 60_000L): DataSnapshot? = withTimeoutOrNull(timeoutMs) {
    suspendCancellableCoroutine { cont ->
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                if (snapshot.exists() && cont.isActive) { removeEventListener(this); cont.resume(snapshot) }
            }

            override fun onCancelled(error: DatabaseError) {
                if (cont.isActive) cont.resumeWithException(error.toException())
            }
        }
        addValueEventListener(listener)
        cont.invokeOnCancellation { removeEventListener(listener) }
    }
}

private const val PHOTO_WAIT_MS = 30_000L

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
