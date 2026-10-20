package com.littlemissparty.quiz.tv

import android.app.Application
import android.content.Context
import android.os.Build
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
import com.littlemissparty.quiz.engine.BlindStatus
import com.littlemissparty.quiz.engine.BlindTrack
import com.littlemissparty.quiz.engine.ChestRound
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
import com.littlemissparty.quiz.engine.ScoreAdjusted
import com.littlemissparty.quiz.engine.PAUSE_TEAM
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.PotatoRound
import com.littlemissparty.quiz.engine.Pump
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.engine.Quiz
import com.littlemissparty.quiz.engine.QuizJson
import com.littlemissparty.quiz.engine.execute
import com.littlemissparty.quiz.engine.programProblem
import com.littlemissparty.quiz.engine.gameGains
import com.littlemissparty.quiz.engine.gameStep
import com.littlemissparty.quiz.engine.nextGameTitle
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

/** Appareil qui demande à entrer en cours de partie ; [replace] : l'équipe qu'il veut reprendre. */
data class JoinRequestUi(val device: String, val name: String, val color: String, val replace: String?)

sealed interface UiState {
    data object MissingConfig : UiState
    data object Connecting : UiState
    data class Error(val message: String) : UiState

    /**
     * Box jamais acceptée dans la Régie PC : rien d'autre que son code d'activation et son modèle.
     * [sent] : la demande est arrivée dans Firebase ; [refused] : la Régie PC l'a refusée.
     */
    data class Locked(val code: String, val model: String, val sent: Boolean = false, val refused: Boolean = false) : UiState

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
        /** Fin d'un jeu : nom du jeu qui commence ensuite (annoncé sur le bouton), null au milieu d'un jeu. */
        val nextGame: String? = null,
        /** Où en est la partie dans le jeu en cours : « Image floue · 3 / 8 », « Quiz · question 5 / 10 ». */
        val etape: String? = null,
        /** Écran de présentation du jeu qui commence : il attend que l'animatrice le lance. */
        val intro: Boolean = false,
        /** Nom du jeu en cours (« Image floue », « Mimes »…), pour sa présentation. */
        val gameTitle: String? = null,
        /** Points multipliés de la question en cours (dernières questions du quiz : ×2, ×3 ou ×5), 1 sinon. */
        val factor: Int = 1,
        /** Annonce « × N » avant la première question multipliée : heure (serveur) où le chrono part ; null sinon. */
        val introUntil: Long? = null,
        /** Heure du serveur où la question s'est ouverte (Portes mystères : présentation des premières secondes). */
        val openedAt: Long? = null,
        /** Questions multipliées restantes, celle-ci comprise (pour l'annonce). */
        val multipliedLeft: Int = 0,
        /** Points gagnés par équipe dans le jeu en cours : vainqueur du jeu, célébré à sa fin (nextGame ou isLast). */
        val gameGains: Map<String, Int> = emptyMap(),
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
        /** Fenêtre « Reconnecter une tablette » ouverte, et les appareils qui demandent à reprendre une équipe. */
        val showTablette: Boolean = false,
        val requests: List<JoinRequestUi> = emptyList(),
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
        /** Blind test en cours (ou qui vient de finir, au bilan), sinon null. */
        val blind: BlindUi? = null,
        /** Portes mystères : ordre d'ouverture, portes déjà ouvertes et valeurs (null hors de ce jeu). */
        val portes: PortesUi? = null,
        /** La bombe cachée : les coffres du jeu en cours (null hors de ce jeu, ou avant leur installation). */
        val coffres: ChestRound? = null,
        /** Gonfleur fou : tapes reçues de chaque équipe pour la course en cours (vide hors de ce jeu). */
        val pumps: Map<String, Int> = emptyMap(),
        /** Gonfleur fou : heure du serveur du « GONFLEZ ! » (le départ 3, 2, 1 remplace le décompte de reprise). */
        val pumpGoAt: Long? = null,
        /** Patate chaude : la bombe (qui la tient, qui l'a envoyée, durée de la mèche), null avant l'allumage. */
        val potato: PotatoRound? = null,
    ) : UiState {
        /** Total des appuis sur le buzzer de l'accueil, pour le son. */
        val funTotal: Int get() = funBuzzes.values.sum()
        val ranking: List<Pair<Team, Int>>
            get() = teams.map { it to (scores[it.uid] ?: 0) }.sortedWith(compareByDescending<Pair<Team, Int>> { it.second }.thenBy { it.first.joinedAt })
    }
}

/**
 * Blind test vu par l'écran : numéro du morceau dans la playlist, sa valeur (et si elle est doublée par rapport aux
 * premiers morceaux), musique en attente du « Lancer » de l'animatrice, extrait déjà entamé, révélation raccourcie,
 * durée de la révélation et morceaux de la playlist.
 */
data class BlindUi(
    val numero: Int,
    val total: Int,
    val points: Int,
    val doubled: Boolean,
    val waiting: Boolean,
    val played: Boolean,
    val cut: Boolean,
    val revealSec: Int,
    val tracks: List<BlindTrack>,
    val playlist: String,
    /** Points gagnés par équipe (uid) pendant ce blind test, pour le bilan. */
    val gains: Map<String, Int> = emptyMap(),
) {
    /** Morceaux à double valeur restant à jouer, celui-ci compris. */
    val doubledLeft: Int get() = tracks.count { it.points > (tracks.minOfOrNull { t -> t.points } ?: 0) && (it.status == BlindStatus.TODO || it.status == BlindStatus.PLAYING) }
}

/** Portes mystères : [order] ordre d'ouverture des portes, [opened] combien sont ouvertes, [doors] leurs valeurs. */
data class PortesUi(val order: List<Int>, val opened: Int, val doors: List<Int>) {
    /** Toutes les portes sont ouvertes : place au classement final. */
    val allOpen: Boolean get() = opened >= doors.size
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
    /** Pictionary : manche jouée équipe par équipe, un mot dessiné par tour (sinon des mimes). */
    val picto: Boolean = false,
    /** Pictionary : équipe qui choisit son mot sur sa tablette (le mot n'est jamais montré sur la TV). */
    val secret: String? = null,
    /** Pictionary : le dessinateur a choisi son mot (Sarah peut masquer le mot et lancer le dessin). */
    val chosen: Boolean = false,
    /** Pictionary : le mot du dernier tour, révélé à tous une fois le tour fini. */
    val lastCard: MimeCard? = null,
    /** Points d'un mime ou d'un dessin trouvé. */
    val points: Int = Scoring.MIME,
)

/**
 * La box est l'unique arbitre de la partie : elle seule fait avancer le jeu et calcule les points.
 * Chaque action est inscrite dans le journal Firebase (`log/`) en même temps que l'état public (`state`),
 * en une seule écriture : après un redémarrage, la partie se reconstruit à l'identique depuis le journal.
 */
class GameViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow<UiState>(UiState.Connecting)
    val state: StateFlow<UiState> = _state

    /** BONUS ou MALUS à montrer par-dessus l'écran : seulement les corrections de la régie que la box vient d'appliquer. */
    private val coups = FileDesCoups()
    private val _coup = MutableStateFlow<CoupDeScore?>(null)
    val coup: StateFlow<CoupDeScore?> = _coup

    /** L'animation [id] est finie : la suivante de la file, s'il y en a une. */
    fun coupFini(id: Int) {
        Log.i(TAG, "Annonce $id terminée")
        _coup.value = coups.fini(id)
    }

    private var gameRef: DatabaseReference? = null
    private var game: Game? = null
    private val listeners = mutableListOf<Pair<DatabaseReference, ValueEventListener>>()
    private var answersListener: Pair<DatabaseReference, ValueEventListener>? = null
    private var buzzListener: Pair<DatabaseReference, ValueEventListener>? = null
    private var pickListener: Pair<DatabaseReference, ValueEventListener>? = null
    private var chestListener: Pair<DatabaseReference, ValueEventListener>? = null
    private var pumpListener: Pair<DatabaseReference, ValueEventListener>? = null
    private var potatoListener: Pair<DatabaseReference, ValueEventListener>? = null

    /** Gonfleur fou : dernières tapes reçues de chaque équipe, pour la course de [pumpListener]. */
    private var pumps: Map<String, Pump> = emptyMap()
    private var drawListener: Pair<DatabaseReference, ChildEventListener>? = null
    private val _dessin = MutableStateFlow(Dessin())

    /** Pictionary : le dessin du tour en cours (ou du dernier tour), reçu de la tablette en direct. */
    val dessin: StateFlow<Dessin> = _dessin
    private var answers: Map<String, Answer> = emptyMap()
    private var countdown: Job? = null
    private var timer: Job? = null
    private var expressTimer: Job? = null
    private var armTimer: Job? = null
    private val actions = Mutex()
    private var serverOffset = 0L
    private var offsetKnown = false
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

    // Déclarés avant `init` : le démarrage peut atteindre le verrou avant toute suspension.
    /** Box acceptée dans la Régie PC (son identifiant Firebase) : elle s'ouvre ensuite même sans Internet. */
    private var boxOk: String?
        get() = prefs.getString("box_ok", null)
        set(value) {
            prefs.edit().apply { if (value == null) remove("box_ok") else putString("box_ok", value) }.commit()
        }

    /** Code court affiché sur la TV et dans la Régie PC, le même tant que la box n'est pas acceptée. */
    private val boxCode: String
        get() = prefs.getString("box_code", null)
            ?: (1..4).map { CODE_CHARS.random() }.joinToString("").also { prefs.edit().putString("box_code", it).commit() }

    private val boxModel: String
        get() = listOf(Build.MANUFACTURER, Build.MODEL).filter { it.isNotBlank() }.distinct()
            .joinToString(" ").ifBlank { "Box Android" }.take(80)

    private var boxDb: FirebaseDatabase? = null
    private val boxWatch = mutableListOf<Pair<DatabaseReference, ValueEventListener>>()
    /** Verrou en place (une box au moins a été acceptée) : une box inconnue ne lance plus de partie. */
    private var lockOn = false
    private var boxRequested = false
    private var requestSeen = false

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
                if (!boxMayPlay(db, uid)) return@launch
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
                val uid = FirebaseAuth.getInstance().currentUser!!.uid
                if (!boxMayPlay(db, uid)) return@launch
                open(db, createGame(db, uid))
            } catch (e: Exception) {
                fail(e)
            }
        }
    }

    // ---------- Activation de la box ----------

    /**
     * true : la box peut lancer une partie. false : l'écran d'activation est affiché.
     * Tant qu'aucune box n'a été acceptée, les box déjà utilisées continuent de jouer : elles envoient
     * seulement leur demande, pour que la Régie PC puisse les accepter.
     */
    private suspend fun boxMayPlay(db: FirebaseDatabase, uid: String): Boolean {
        watchBox(db, uid)
        if (boxOk == uid) return true
        // Lecture refusée (règles pas encore publiées) : jamais de blocage pour autant.
        val allowed = runCatching { db.getReference("boxes/allowed/$uid").readOnce() }.getOrElse { return true }
        if (allowed?.exists() == true) {
            boxOk = uid
            return true
        }
        val lock = runCatching { db.getReference("boxes/lockOn").readOnce() }.getOrElse { return true }
            ?: error("La base Firebase ne répond pas. Vérifiez Internet puis réessayez.")
        lockOn = lock.value == true
        requestActivation(db, uid)
        if (!lockOn) return true
        showLock()
        return false
    }

    private fun showLock(refused: Boolean = false) {
        stopListening()
        timer?.cancel()
        expressTimer?.cancel()
        armTimer?.cancel()
        _state.value = UiState.Locked(code = boxCode, model = boxModel, sent = requestSeen, refused = refused)
    }

    private fun requestActivation(db: FirebaseDatabase, uid: String) {
        if (boxRequested) return
        boxRequested = true
        db.getReference("boxes/requests/$uid")
            .setValue(mapOf("code" to boxCode, "model" to boxModel, "at" to ServerValue.TIMESTAMP))
            .addOnFailureListener { e ->
                boxRequested = false
                Log.e(TAG, "Demande d'activation refusée", e)
            }
    }

    /** « Redemander » après un refus de la Régie PC. */
    fun requestAgain() {
        val db = boxDb ?: return start()
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return start()
        boxRequested = false
        requestActivation(db, uid)
        _state.update { if (it is UiState.Locked) it.copy(refused = false) else it }
    }

    /** Suit l'acceptation, le refus et le retrait de cette box, partie ou pas. */
    private fun watchBox(db: FirebaseDatabase, uid: String) {
        if (boxWatch.isNotEmpty()) return
        boxDb = db
        fun listen(path: String, onData: (DataSnapshot) -> Unit) {
            val ref = db.getReference(path)
            val listener = object : ValueEventListener {
                override fun onDataChange(snapshot: DataSnapshot) = onData(snapshot)
                override fun onCancelled(error: DatabaseError) {
                    Log.e(TAG, "Lecture refusée $path : ${error.message}")
                }
            }
            ref.addValueEventListener(listener)
            boxWatch += ref to listener
        }
        listen("boxes/lockOn") { snap -> lockOn = snap.value == true }
        listen("boxes/allowed/$uid") { snap ->
            when {
                snap.exists() -> {
                    boxOk = uid
                    if (_state.value is UiState.Locked) start()
                }
                boxOk == uid -> {
                    // Retirée dans la Régie PC : jamais en pleine partie, seulement à l'accueil ou à la fin.
                    boxOk = null
                    boxRequested = false
                    if (lockOn) lockIfIdle()
                }
                else -> Unit
            }
        }
        listen("boxes/requests/$uid") { snap ->
            if (snap.exists()) requestSeen = true
            _state.update { if (it is UiState.Locked) it.copy(sent = snap.exists() || it.sent) else it }
            if (!snap.exists() && requestSeen && _state.value is UiState.Locked) {
                // Demande effacée : acceptée (l'autorisation arrive au même moment) ou refusée.
                viewModelScope.launch {
                    delay(BOX_REFUSAL_CHECK_MS)
                    if (boxOk != uid) _state.update { if (it is UiState.Locked) it.copy(refused = true) else it }
                }
            }
        }
    }

    private fun lockIfIdle() {
        val s = _state.value
        val idle = s is UiState.Error ||
            (s is UiState.Playing && (s.phase == Phase.ENDED || (s.phase == Phase.LOBBY && s.teams.isEmpty())))
        if (!idle) return
        activeCode = null
        showLock()
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
        soundMarks.clear()
        // Partie rouverte ou relue : les corrections du journal ne se rejouent jamais à l'écran.
        coups.vider()
        _coup.value = null
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
        // Portes mystères et bombe cachée : pas de chrono, rien ne se ferme seul.
        if (g.state.phase == Phase.QUESTION && !g.state.paused && g.question?.isPortes != true && g.question?.isCoffres != true &&
            g.remainingMs(serverNow()) == 0L
        ) {
            // Comme à la fin du chrono : question fermée, tour de mimes terminé, extrait du blind test arrêté.
            act { it.timeUp(serverNow()) ?: it.balloon(pumps, teams().map { t -> t.uid }, serverNow(), stop = true) }
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
                // Présentation d'un jeu : OK lance l'épreuve, comme « ▶ Lancer l'épreuve » de la régie.
                Phase.QUESTION -> if (g.state.intro || g.question?.isTurns == true) commit(g.next(serverNow()))
                // Blind test : OK lance (ou relance) la musique, ou l'arrête ; une équipe qui a buzzé est jugée par ses boutons.
                else if (g.question?.isBlind == true) {
                    if (g.state.buzz?.team != null) return@withLock
                    if (g.state.buzz?.waiting == true) commit(g.blindPlay(serverNow(), unblock = allBlocked(g)))
                    else if (!g.justStarted(serverNow())) commit(g.blindStop(serverNow()))
                }
                // Gonfleur fou : OK arrête la course, le plus gros ballon gagne.
                else if (g.question?.isGonfleur == true) {
                    if (!g.justStarted(serverNow())) commit(g.balloon(pumps, teams().map { it.uid }, serverNow(), stop = true))
                }
                // Chrono qui vient de partir : second appui d'un double clic, même livré en retard par la box.
                else if (!g.justStarted(serverNow())) commit(g.close(serverNow()))
                Phase.CLOSED -> commit(g.reveal(serverNow(), collectAnswers()))
                else -> commit(g.next(serverNow()))
            }
        } }
    }

    /** Blind test : toutes les équipes inscrites ont déjà tenté leur chance sur ce morceau. */
    private fun allBlocked(g: Game): Boolean {
        val blocked = g.state.buzz?.blocked.orEmpty()
        val ids = teams().map { it.uid }
        return blocked.isNotEmpty() && ids.isNotEmpty() && blocked.containsAll(ids)
    }

    /** Blind test à la télécommande : révéler sans gagnant, passer le morceau. */
    fun blindReveal() = act { it.blindReveal(serverNow()) }
    fun blindSkip() = act { it.blindSkip(serverNow()) }

    /** La bombe cachée, à la télécommande (pas de régie) : un coffre au hasard pour l'équipe qui joue. */
    fun chestRandom() = act { it.openRandomChest(serverNow()) }

    /** Patate chaude, à la télécommande (pas de régie) : la bombe part au hasard chez une équipe permise. */
    fun potatoRandom() = act { it.passPotatoRandom(serverNow()) }

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
    fun judgeBuzz(ok: Boolean) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastNextAt < NEXT_GUARD_MS) return
        lastNextAt = now
        act { it.judgeBuzz(ok, serverNow()) }
    }
    fun mimeStop() = act { it.mimeStop(serverNow()) }
    fun pause() = act { it.pause(serverNow()) }
    fun unpause() = act { it.resume(serverNow()) }

    /**
     * Points donnés à la télécommande (menu Retour), utiles surtout sans Internet : les équipes montrent leurs
     * cartes A B C D et l'animatrice saisit les points. Même annonce sur la TV qu'un bonus de la régie.
     */
    fun givePoints(teamIds: List<String>, delta: Int) {
        viewModelScope.launch { actions.withLock {
            val g = game ?: return@withLock
            val known = teams().map { it.uid }.toSet()
            for (t in teamIds.distinct().filter { it in known }) {
                val avant = g.state.scores()[t] ?: 0
                val e = g.remotePoints(t, delta, serverNow()) ?: continue
                commit(e)
                (e as? ScoreAdjusted)?.let { montrerCoup(it, avant, g.state.scores()[t] ?: 0) }
            }
        } }
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
        // Jeu rejoué depuis la régie : ses anciennes réponses sont effacées, les pupitres peuvent répondre à nouveau.
        val replayed = (event as? Jumped)?.clear.orEmpty().associate { "answers/$it" to null } +
            // Question ouverte : ses anciennes réponses (jeu déjà joué puis repris plus tôt dans le programme)
            // sont effacées, sinon les règles refuseraient les nouvelles et la question ne rapporterait rien.
            ((event as? QuestionOpened)?.let { mapOf("answers/${it.qid}" to null) } ?: emptyMap()) +
            // Portes mystères : valeurs en vigueur derrière les portes (l'animatrice peut les changer), pour la régie seule.
            (g.question?.takeIf { it.isPortes }?.let { mapOf("conducteur/doorValues/${it.id}" to g.doorsOf(it)) } ?: emptyMap())
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
        // Lecture refusée ou impossible (box hors ligne) : on garde les réponses déjà reçues, sans planter.
        val fresh = runCatching {
            withTimeoutOrNull(4000) { gameRef?.child("answers/$qid")?.get()?.await()?.let(::parseAnswers) }
        }.onFailure { Log.w(TAG, "Réponses relues impossibles", it) }.getOrNull()
        val known = teams().map { it.uid }.toSet()
        return (fresh ?: answers).filterKeys { it in known }
    }

    private fun teams(): List<Team> = (_state.value as? UiState.Playing)?.teams.orEmpty()

    /** Une correction vient d'être appliquée par la box (commande en direct, jamais relue du journal). */
    private fun montrerCoup(e: ScoreAdjusted, avant: Int, apres: Int) {
        if (e.delta == 0) return
        val team = teams().firstOrNull { it.uid == e.team } ?: return
        Log.i(TAG, "Annonce ${if (e.delta > 0) "BONUS" else "MALUS"} ${e.delta} pour ${team.name} (événement ${e.seq})")
        _coup.value = coups.ajouter(CoupDeScore(e.seq, team.uid, team.name, team.color, e.delta, avant, apres))
    }

    /** Ferme automatiquement la question à la fin du chrono ; au Vrai ou Faux express, enchaîne aussi la suite. */
    private fun schedule() {
        timer?.cancel()
        scheduleExpress()
        scheduleArm()
        val g = game ?: return
        val deadline = g.deadline() ?: return
        timer = viewModelScope.launch {
            // Réveil trop tôt (heure du serveur corrigée entre-temps) : on attend encore, sans jamais abandonner.
            while (game === g && g.deadline() == deadline) {
                delay((deadline - serverNow() + CLOSE_GRACE_MS).coerceAtLeast(100))
                val done = actions.withLock {
                    if (g.state.phase == Phase.QUESTION && !g.state.paused && g.remainingMs(serverNow()) == 0L) {
                        // Fin de la question, ou fin du tour de mimes.
                        // Gonfleur fou : au bout du chrono de secours, le plus gros ballon gagne.
                        commit(g.timeUp(serverNow()) ?: g.balloon(pumps, teams().map { it.uid }, serverNow(), stop = true))
                        true
                    } else g.deadline() != deadline
                }
                if (done) return@launch
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
        val mimeCounts = q?.takeIf { it.isTurns }?.let { s.mimes[it.id] }.orEmpty()
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
                // Patate chaude : la mèche tirée au sort remplace la durée de la question.
                remainingMs = q?.let { g.durationOf(it) - s.elapsedAt(Long.MAX_VALUE) }?.coerceAtLeast(0) ?: 0,
                awards = revealedAwards,
                scores = s.scores(),
                buzzTeam = s.buzz?.team,
                buzzBlocked = s.buzz?.blocked.orEmpty(),
                blind = q?.takeIf { it.isBlind && s.phase != Phase.LOBBY }?.let { blindUi(g) },
                portes = q?.takeIf { it.isPortes && s.phase != Phase.LOBBY }?.let { PortesUi(g.doorOrder(), s.doorsOpened, g.doorsOf(it)) },
                coffres = g.chestRound.takeIf { s.phase != Phase.LOBBY },
                lastGain = if (q?.isTurns == true) mimeCounts.mapValues { it.value * s.pointsPerFound(q.id) } else revealedAwards.mapValues { it.value.points },
                isLast = g.isLastQuestion,
                nextGame = g.nextGameTitle(),
                etape = g.gameStep()?.label,
                intro = s.intro,
                gameTitle = g.gameStep()?.title,
                factor = g.factorOf(s.index),
                introUntil = g.multiplierIntroUntil(),
                pumpGoAt = g.pumpGoAt,
                potato = s.potato.takeIf { q?.isPatate == true && s.phase != Phase.LOBBY },
                openedAt = s.openedAt,
                multipliedLeft = g.multipliedLeft(s.index),
                gameGains = g.gameGains(),
                mime = q?.takeIf { it.isTurns && s.phase != Phase.LOBBY }?.let {
                    val m = s.mime
                    MimeUi(
                        // Pictionary : le mot reste secret sur la TV pendant le tour (seule la tablette du dessinateur l'affiche).
                        team = m?.team, card = g.mimeCard.takeIf { !q.isPicto }, found = m?.found ?: 0, passed = m?.passed ?: 0,
                        left = m?.deck?.size ?: 0, last = m?.last, counts = mimeCounts, turns = m?.turns.orEmpty(),
                        picto = q.isPicto, secret = m?.secret, chosen = m?.pick != null, lastCard = g.lastCard, points = s.pointsPerFound(q.id),
                    )
                },
            )
        }
        watchAnswers(s.qid.takeIf { s.phase == Phase.QUESTION || s.phase == Phase.CLOSED })
        // Image floue : on écoute le buzzer de cet essai ; toutes les équipes bloquées, l'image se ferme.
        watchBuzz(Codec.buzzKey(g)?.takeIf { !s.buzzHeld && !s.paused })
        // Pictionary : le choix du mot sur la tablette du dessinateur, puis son dessin en direct.
        watchPick(Codec.pickKey(g)?.takeIf { !s.paused })
        watchDrawing(Codec.drawKey(g))
        // La bombe cachée : coffres installés dès le lancement du jeu, puis le choix de la tablette de l'équipe qui joue.
        if (g.needsChests() && teams().isNotEmpty()) {
            act { it.dealChests(teams().sortedBy { t -> t.joinedAt }.map { t -> t.uid }, serverNow()) }
        }
        watchChest(Codec.chestKey(g)?.takeIf { !s.paused })
        // Gonfleur fou : les tapes des tablettes, de la course au bilan (les ballons restent à leur taille).
        watchPumps(Codec.pumpKey(g))
        // Patate chaude : la box allume la mèche dès le lancement du jeu (équipe de départ et durée tirées au sort),
        // puis écoute l'envoi de la tablette de l'équipe qui tient la bombe.
        if (g.needsPotato() && teams().size >= 2) act { it.lightPotato(teams().map { t -> t.uid }, serverNow()) }
        watchPotato(Codec.potatoKey(g)?.takeIf { !s.paused })
        val blocked = s.buzz?.blocked.orEmpty()
        val teamIds = teams().map { it.uid }
        // Blind test : rien ne se ferme seul, la relance réautorise tout le monde.
        if (s.phase == Phase.QUESTION && !s.paused && !s.buzzHeld && q?.isBlind != true && teamIds.isNotEmpty() && blocked.containsAll(teamIds)) {
            act { it.takeIf { g -> g.state.phase == Phase.QUESTION && g.state.buzz?.blocked.orEmpty().containsAll(teamIds) }?.close(serverNow()) }
        }
        // Photo de la question en cours et de la suivante chargées d'avance (dès le salon d'attente pour la
        // première) : la révélation, ou le Zoom mystère, ne l'attend jamais.
        listOfNotNull(q?.imageId.takeIf { s.phase != Phase.LOBBY }, g.quiz.questions.getOrNull(s.index + 1)?.imageId).forEach(::prefetchImage)
        // Réponses en images : celles de la question en cours et de la suivante (lisibles aussi par les pupitres).
        listOfNotNull(q, g.quiz.questions.getOrNull(s.index + 1)).flatMap { it.choiceImages }.filterNotNull()
            .forEach { prefetchImage(it, "choiceImages") }
        // Pictionary : photos des mots proposés (rangées avec les réponses en images), prêtes pour la révélation.
        (g.offerCards + listOfNotNull(g.lastCard)).mapNotNull { it.imageId }.forEach { prefetchImage(it, "choiceImages") }
        // Photos : toutes celles du programme gardées sur la box, pour une fête qui continue sans Internet.
        savePhotos(g)
        // Extraits musicaux : tous ceux du programme, dès son chargement, pour que la musique ne dépende
        // plus du réseau une fois la partie lancée.
        g.quiz.questions.flatMapTo(LinkedHashSet()) { listOfNotNull(it.audioId) + it.audioIds }.forEach(::prefetchSound)
    }

    private fun blindUi(g: Game): BlindUi {
        val q = g.question!!
        val tracks = g.blindTracks()
        val i = tracks.indexOfFirst { it.qid == q.id }
        val points = tracks.getOrNull(i)?.points ?: q.trackPoints
        return BlindUi(
            numero = i + 1, total = tracks.size, points = points,
            doubled = points > (tracks.minOfOrNull { it.points } ?: points),
            waiting = g.state.buzz?.waiting == true, played = g.state.segments.isNotEmpty(),
            cut = g.state.revealCut == q.id, revealSec = q.revealSec, tracks = tracks,
            playlist = q.roundTitle.orEmpty(),
            gains = tracks.flatMap { g.state.awards[it.qid].orEmpty().entries }
                .groupBy({ it.key }, { it.value.points }).mapValues { (_, p) -> p.sum() },
        )
    }

    private val soundFiles = mutableMapOf<String, String>()
    /** État de chaque extrait déjà publié pour la régie dans cette partie (prêt, en chargement, manquant). */
    private val soundMarks = mutableMapOf<String, String>()

    /** La régie voit, morceau par morceau, si la box a bien l'extrait avant de le lancer. */
    private fun markSound(id: String, status: String) {
        if (soundMarks[id] == status) return
        val ref = gameRef ?: return
        soundMarks[id] = status
        ref.child("media/$id").setValue(status)
    }
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
            markSound(id, "ok")
            // Nouvelle partie sur la même box : l'extrait déjà en cache est remis dans l'état de l'écran.
            if ((_state.value as? UiState.Playing)?.sounds?.containsKey(id) == false) updatePlaying { it.copy(sounds = soundFiles.toMap()) }
            return
        }
        if (!soundsLoading.add(id)) return
        markSound(id, "loading")
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
            markSound(id, "missing")
        }
    }

    private fun publishSound(id: String, file: java.io.File) {
        soundsLoading -= id
        soundFiles[id] = file.absolutePath
        markSound(id, "ok")
        updatePlaying { it.copy(sounds = soundFiles.toMap()) }
    }

    private val imageBytes = object : LinkedHashMap<String, ByteArray>(8, 0.75f, true) {
        // Quelques photos seulement en mémoire : la box ancienne a peu de place.
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ByteArray>?) = size > 4
    }
    private val imagesLoading = mutableSetOf<String>()

    /**
     * Lit une photo d'illustration : d'abord sur la box (gardée dès le chargement du programme), sinon dans la
     * partie. Absente, abîmée ou hors connexion sans copie : la question reste sans photo.
     */
    private fun prefetchImage(id: String, dir: String = "images") {
        if (id in imageBytes || !imagesLoading.add(id)) return
        val ref = gameRef ?: return run { imagesLoading -= id }
        viewModelScope.launch {
            val bytes = photoOnBox(id) ?: downloadPhoto(ref, dir, id)
            imagesLoading -= id
            if (bytes == null) return@launch
            imageBytes[id] = bytes
            updatePlaying { it.copy(images = imageBytes.toMap()) }
        }
    }

    /** Photos gardées sur la box (filesDir/photos/<empreinte>) : la fête garde ses images si Internet coupe. */
    private val photoDir by lazy { java.io.File(getApplication<Application>().filesDir, "photos") }
    private var photosSavedFor: Any? = null

    private suspend fun photoOnBox(id: String): ByteArray? = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        runCatching { java.io.File(photoDir, id).takeIf { it.isFile && it.length() > 0 }?.readBytes() }.getOrNull()
    }

    /** Copie une photo de la partie sur la box ; l'identifiant est l'empreinte du contenu, donc jamais périmé. */
    private suspend fun downloadPhoto(ref: DatabaseReference, dir: String, id: String): ByteArray? {
        val bytes = runCatching {
            // Attente de la copie par la régie : une lecture unique pourrait renvoyer « absente » depuis le cache.
            val data = ref.child("$dir/$id").readWhenPresent(PHOTO_WAIT_MS)?.getValue(String::class.java)
            data?.substringAfter("base64,", "")?.takeIf { it.isNotEmpty() }?.let { Base64.decode(it, Base64.DEFAULT) }
        }.getOrNull() ?: return null
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            runCatching {
                photoDir.mkdirs()
                val part = java.io.File(photoDir, "$id.part")
                part.writeBytes(bytes)
                part.renameTo(java.io.File(photoDir, id))
            }
        }
        return bytes
    }

    /**
     * Toutes les photos du programme copiées sur la box dès son chargement, une par une et sans les garder en
     * mémoire : si Internet coupe ensuite, chaque question garde sa photo. Les plus anciennes copies sont
     * effacées au-delà de [PHOTOS_MAX] fichiers (la Mi Box a peu de place).
     */
    private fun savePhotos(g: Game) {
        if (photosSavedFor === g.quiz) return
        photosSavedFor = g.quiz
        val ref = gameRef ?: return
        val wanted = LinkedHashMap<String, String>()
        g.quiz.questions.forEach { q ->
            q.imageId?.let { wanted.putIfAbsent(it, "images") }
            q.choiceImages.filterNotNull().forEach { wanted.putIfAbsent(it, "choiceImages") }
            q.cards.mapNotNull { it.imageId }.forEach { wanted.putIfAbsent(it, "choiceImages") }
        }
        viewModelScope.launch {
            for ((id, dir) in wanted) {
                if (gameRef != ref) return@launch
                val there = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { java.io.File(photoDir, id).let { it.isFile && it.length() > 0 } }
                if (!there && id !in imagesLoading) downloadPhoto(ref, dir, id)
            }
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                runCatching {
                    val files = photoDir.listFiles()?.filter { it.isFile }.orEmpty()
                    if (files.size > PHOTOS_MAX) files.sortedBy { it.lastModified() }.take(files.size - PHOTOS_MAX)
                        .filter { it.name !in wanted }.forEach { it.delete() }
                }
            }
        }
    }

    // ---------- Régie (téléphone de l'animatrice) ----------

    fun showRegie() = updatePlaying { it.copy(showRegie = true) }
    fun hideRegie() = updatePlaying { it.copy(showRegie = false) }
    fun showTablette() = updatePlaying { it.copy(showTablette = true) }
    fun hideTablette() = updatePlaying { it.copy(showTablette = false) }

    /** « Reconnecter une tablette » : l'animatrice confie à la TV l'équipe que la nouvelle tablette a choisie. */
    fun confierTablette(device: String, team: String) {
        viewModelScope.launch {
            val refus = actions.withLock { admitDevice(null, replace = true, device = device, team = team) }
            // Tablette confiée : la fenêtre se referme, la partie reprend où elle en était.
            if (refus == null) hideTablette()
        }
    }

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
            val device = snap.child("device").getValue(String::class.java)
            val team = snap.child("team").getValue(String::class.java)
            viewModelScope.launch { actions.withLock { admitDevice(id, replace = type == REPLACE, device = device, team = team) } }
            return
        }
        val cmd = (snap.value as? Map<*, *>)?.let { Command.decode(id, it) }
        val sentAt = snap.child("at").getValue(Long::class.java)
        viewModelScope.launch { actions.withLock {
            val g = game ?: return@withLock
            if (cmd == null) {
                gameRef?.updateChildren(statusOf(id, CommandResult(CommandStatus.REFUSED, reason = "invalid")))
                return@withLock
            }
            // Commande restée sans réponse (box éteinte ou hors ligne) : la régie a déjà dit « la TV ne répond pas »
            // et l'animatrice a pu la renvoyer. Rejouée plus tard, une correction de score compterait deux fois.
            // Seulement les commandes sans numéro d'étape (pause, reprise, corrections) : les autres sont déjà
            // refusées si la partie a bougé. Et seulement une fois l'heure du serveur connue.
            val unguarded = cmd is Command.Pause || cmd is Command.Resume || cmd is Command.Adjust || cmd is Command.Undo || cmd is Command.MimeFix
            if (unguarded && offsetKnown && sentAt != null && serverNow() - sentAt > STALE_COMMAND_MS) {
                gameRef?.updateChildren(statusOf(id, CommandResult(CommandStatus.REFUSED, reason = "too_old")))
                return@withLock
            }
            val answers = if (cmd is Command.Next && g.state.phase == Phase.CLOSED) collectAnswers() else emptyMap()
            val avant = g.state.scores()
            val result = g.execute(cmd, serverNow(), teams().map { it.uid }.toSet(), answers, pumps)
            if (result.event != null) commit(result.event, statusOf(id, result))
            else gameRef?.updateChildren(statusOf(id, result))
            (result.event as? ScoreAdjusted)?.let { e -> montrerCoup(e, avant[e.team] ?: 0, g.state.scores()[e.team] ?: 0) }
        } }
    }

    /**
     * Appareil arrivé en cours de partie, accepté par la régie : nouvelle équipe, ou remplaçant d'une équipe
     * existante, qui garde son nom, sa couleur et ses points (ils sont rangés sous l'identifiant de l'équipe).
     * Les règles Firebase n'acceptent plus rien de l'ancien appareil. La demande est effacée dans la même écriture.
     * [id] : commande de la régie, qui reçoit la réponse ; null quand l'animatrice confirme à la télécommande.
     */
    private suspend fun admitDevice(id: String?, replace: Boolean, device: String?, team: String?): String? {
        val ref = gameRef ?: return "gone"
        val request = device?.let { runCatching { ref.child("joinRequests/$it").readOnce() }.getOrNull() }?.takeIf { it.exists() }
        val teams = teams()
        val reason = when {
            device == null || request == null -> "gone"
            teams.any { it.uid == device || it.device == device } -> "busy"
            !replace && teams.size >= MAX_TEAMS -> "full"
            replace && teams.none { it.uid == team } -> "unknown_team"
            else -> null
        }
        val updates = mutableMapOf<String, Any?>()
        if (id != null) updates["commandStatus/$id"] = clean(
            mapOf("status" to if (reason == null) "applied" else "refused", "reason" to reason, "at" to ServerValue.TIMESTAMP)
        )
        if (id == null && reason != null) Log.w(TAG, "Tablette non confiée : $reason")
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
        if (updates.isNotEmpty()) ref.updateChildren(updates).addOnFailureListener { Log.e(TAG, "Entrée d'un appareil refusée", it) }
        return reason
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
            offsetKnown = snap.value != null
            // Le chrono surveillé l'était peut-être avec l'ancienne heure : on le recale.
            schedule()
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
        observe(ref.child("joinRequests")) { snap ->
            val list = snap.children.mapNotNull { r ->
                val device = r.key ?: return@mapNotNull null
                JoinRequestUi(
                    device,
                    r.child("name").getValue(String::class.java) ?: "Équipe",
                    r.child("color").getValue(String::class.java) ?: "#FFFFFF",
                    r.child("replace").getValue(String::class.java),
                )
            }
            updatePlaying { it.copy(requests = list) }
        }
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
                    // Blind test : seulement pendant la musique (en attente de relance, rien ne court).
                    val waited = g.state.phase == Phase.QUESTION && !g.state.paused && g.remainingMs(serverNow()) > 0 &&
                        g.question?.isTurns != true && g.state.buzz?.waiting != true
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

    /** Pictionary : le dessinateur choisit son mot sur sa tablette (games/<code>/pictoChoice/<clé>). */
    private fun watchPick(key: String?) {
        if (key == pickListener?.first?.key) return
        pickListener?.let { (r, l) -> r.removeEventListener(l) }
        pickListener = null
        val ref = gameRef?.child("pictoChoice")?.child(key ?: return) ?: return
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val i = snapshot.child("i").getValue(Int::class.java) ?: return
                act { g -> if (Codec.pickKey(g) == key) g.pictoChoose(i, serverNow()) else null }
            }

            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Choix du Pictionary : ${error.message}")
            }
        }
        ref.addValueEventListener(listener)
        pickListener = ref to listener
    }

    /**
     * Gonfleur fou : les tapes de chaque équipe (games/<code>/pumps/<clé>/<équipe> = { n, at }), envoyées par les
     * tablettes. Les règles de la base n'acceptent que l'appareil de l'équipe, après le départ, hors pause, sans
     * jamais redescendre. Un ballon qui éclate termine la course.
     */
    private fun watchPumps(key: String?) {
        if (key == pumpListener?.first?.key) return
        pumpListener?.let { (r, l) -> r.removeEventListener(l) }
        pumpListener = null
        pumps = emptyMap()
        updatePlaying { it.copy(pumps = emptyMap()) }
        val ref = gameRef?.child("pumps")?.child(key ?: return) ?: return
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val lus = snapshot.children.mapNotNull { c ->
                    val n = c.child("n").getValue(Int::class.java) ?: return@mapNotNull null
                    val at = c.child("at").getValue(Long::class.java) ?: return@mapNotNull null
                    c.key!! to Pump(n, at)
                }.toMap()
                if (pumpListener?.first?.key != key) return
                pumps = lus
                updatePlaying { it.copy(pumps = lus.mapValues { e -> e.value.n }) }
                act { g -> if (Codec.pumpKey(g) != key) null else g.balloon(lus, teams().map { it.uid }, serverNow(), stop = false) }
            }

            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Tapes du Gonfleur fou : ${error.message}")
            }
        }
        // Clé posée avant le premier appel : une réponse en cache peut arriver tout de suite.
        pumpListener = ref to listener
        ref.addValueEventListener(listener)
    }

    /**
     * Patate chaude : l'envoi de la tablette de l'équipe qui tient la bombe (games/<code>/potatoPass/<clé> =
     * { to, at }). Les règles de la base n'acceptent que l'appareil de cette équipe, après la mèche qui colle, vers
     * une équipe permise. Une clé par réception : un envoi ne peut servir qu'une fois.
     */
    private fun watchPotato(key: String?) {
        if (key == potatoListener?.first?.key) return
        potatoListener?.let { (r, l) -> r.removeEventListener(l) }
        potatoListener = null
        val ref = gameRef?.child("potatoPass")?.child(key ?: return) ?: return
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val to = snapshot.child("to").getValue(String::class.java) ?: return
                val at = snapshot.child("at").getValue(Long::class.java) ?: serverNow()
                act { g ->
                    val holder = g.state.potato?.holder
                    if (Codec.potatoKey(g) != key || holder == null) null else g.passPotato(holder, to, serverNow(), sentAt = at)
                }
            }

            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Envoi de la patate chaude : ${error.message}")
            }
        }
        potatoListener = ref to listener
        ref.addValueEventListener(listener)
    }

    /**
     * La bombe cachée : le coffre choisi par la tablette de l'équipe qui joue (games/<code>/chestChoice/<clé>). Les
     * règles de la base n'acceptent que l'appareil de cette équipe, une fois l'animation précédente finie. Le
     * contenu est tiré au sort ici, au moment de l'ouverture.
     */
    private fun watchChest(key: String?) {
        if (key == chestListener?.first?.key) return
        chestListener?.let { (r, l) -> r.removeEventListener(l) }
        chestListener = null
        val ref = gameRef?.child("chestChoice")?.child(key ?: return) ?: return
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val i = snapshot.child("i").getValue(Int::class.java) ?: return
                act { g ->
                    val team = g.chestRound?.team
                    if (Codec.chestKey(g) != key || team == null) null
                    // L'écriture a été acceptée par la base : l'animation précédente était finie à l'heure du serveur.
                    else g.openChest(team, i, maxOf(serverNow(), g.chestRound!!.readyAt))
                }
            }

            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Coffre de la bombe cachée : ${error.message}")
            }
        }
        ref.addValueEventListener(listener)
        chestListener = ref to listener
    }

    /**
     * Pictionary : le dessin du tour [key], paquet de traits par paquet de traits, dans l'ordre de la tablette.
     * Il reste affiché après le tour (avec le mot) jusqu'au tour suivant ; une box relancée le relit en entier.
     */
    private fun watchDrawing(key: String?) {
        if (key == drawListener?.first?.key && (key == null || _dessin.value.cle == key)) return
        drawListener?.let { (r, l) -> r.removeEventListener(l) }
        drawListener = null
        _dessin.value = Dessin(key)
        val ref = gameRef?.child("drawing")?.child(key ?: return) ?: return
        val listener = object : ChildEventListener {
            override fun onChildAdded(snapshot: DataSnapshot, previousChildName: String?) {
                val paquet = snapshot.value as? Map<*, *> ?: return
                _dessin.update { d -> if (d.cle == key) d.avec(paquet) else d }
            }

            override fun onChildChanged(snapshot: DataSnapshot, previousChildName: String?) = Unit
            override fun onChildRemoved(snapshot: DataSnapshot) = Unit
            override fun onChildMoved(snapshot: DataSnapshot, previousChildName: String?) = Unit
            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Dessin du Pictionary : ${error.message}")
            }
        }
        ref.addChildEventListener(listener)
        drawListener = ref to listener
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
     * Box sans Internet : passé le délai de grâce, la question en cours se fige une fois (pause écrite sur la box,
     * envoyée au retour du réseau). L'animatrice relance quand elle veut et continue à la télécommande ;
     * à la reconnexion, rien ne repart seul.
     */
    private fun onConnection(connected: Boolean) {
        offlineWatch?.cancel()
        offlineWatch = null
        if (connected) return
        val since = SystemClock.elapsedRealtime()
        offlineWatch = viewModelScope.launch {
            // Une seule pause par coupure : si l'animatrice relance, la fête continue à la télécommande.
            var paused = false
            while (true) {
                delay(1000)
                actions.withLock {
                    val g = game ?: return@withLock
                    val event = g.networkPause(serverNow(), SystemClock.elapsedRealtime() - since, paused)
                    if (event != null) {
                        paused = true
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
        watchPick(null)
        watchChest(null)
        watchPumps(null)
        watchPotato(null)
        watchDrawing(null)
        commandsListener?.let { (r, l) -> r.removeEventListener(l) }
        commandsListener = null
        judging.clear()
    }

    override fun onCleared() {
        stopListening()
        boxWatch.forEach { (r, l) -> r.removeEventListener(l) }
        boxWatch.clear()
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

        /** Une commande de la régie plus ancienne que cela n'est plus appliquée (la régie a abandonné après 6 s). */
        private const val STALE_COMMAND_MS = 15_000L

        /** Délai laissé aux réponses envoyées à la dernière seconde avant de fermer la question. */
        private const val CLOSE_GRACE_MS = 500L

        /** Temps laissé à un pupitre déconnecté pour revenir seul avant la pause automatique. */
        private const val DROP_GRACE_MS = 4000L

        /** Deux appuis sur OK plus rapprochés que cela ne font avancer que d'une étape. */
        private const val NEXT_GUARD_MS = 500L
        private const val CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        /** Demande effacée sans autorisation au bout de ce délai : la Régie PC l'a refusée. */
        private const val BOX_REFUSAL_CHECK_MS = 2_000L

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
            // Présentation de chaque jeu (prestations) : gardée au redémarrage de la box, qui relit ce conducteur.
            "intros" to quiz.intros,
            // Cette box sait jouer les mimes : la régie prévient avant d'en envoyer à une TV trop ancienne.
            "mimes" to true,
            "pictionary" to true,
            "numbers" to true,
            "express" to true,
            "zoom" to true,
            "flou" to true,
            "chante" to true,
            "quisuis" to true,
            "blind" to true,
            // Blind test morceau par morceau : « Lancer le morceau », relance, révéler sans points, passer, bilan.
            "blindPlay" to true,
            "statues" to true,
            // Portes mystères (jeu final) : choix d'une porte sur les tablettes, ouverture une à une.
            "portes" to true,
            // Portes mystères : l'animatrice peut changer les valeurs derrière les portes (commande portes_set).
            "portesSet" to true,
            // La bombe cachée : coffres ouverts depuis les tablettes, coffre au hasard en secours (commande chest_random).
            "coffres" to true,
            // Gonfleur fou : tapes des tablettes dans pumps/, fin de la course par la box.
            "gonfleur" to true,
            // Patate chaude : envois des tablettes dans potatoPass/, mèche et explosion par la box, envoi au hasard (potato_random).
            "patate" to true,
            // Statues musicales : les chansons choisies (audioIds) jouées l'une après l'autre.
            "statuesChansons" to true,
            "disparu" to true,
            "questions" to quiz.questions.map {
                clean(mapOf(
                    "id" to it.id, "text" to it.text, "choices" to it.choices.ifEmpty { null }, "correct" to it.correct,
                    "duration" to it.durationSec, "kind" to it.kind.code, "double" to it.double, "round" to it.roundTitle,
                    "cards" to it.cards.ifEmpty { null }?.map { c -> clean(mapOf("word" to c.word, "image" to c.image, "imageId" to c.imageId)) },
                    "image" to it.emoji, "imageId" to it.imageId, "artist" to it.artist, "audioId" to it.audioId,
                    "audioIds" to it.audioIds.ifEmpty { null },
                    "doors" to it.doors.ifEmpty { null },
                    "choiceImages" to it.choiceImages.ifEmpty { null }?.map { id -> id ?: "" },
                    // Blind test : valeur et durée de révélation du morceau, relues telles quelles après un redémarrage.
                    "points" to it.points?.takeIf { _ -> it.isBlind }, "reveal" to it.revealSec.takeIf { _ -> it.isBlind },
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
/** Photos gardées sur la box au plus (environ 50 Ko chacune) ; celles du programme en cours ne sont jamais effacées. */
private const val PHOTOS_MAX = 600

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
