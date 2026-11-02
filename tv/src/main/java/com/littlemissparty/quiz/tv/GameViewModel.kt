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
import com.littlemissparty.quiz.engine.DuelRound
import com.littlemissparty.quiz.engine.ChronoRound
import com.littlemissparty.quiz.engine.chronoGagnes
import com.littlemissparty.quiz.engine.SimonAnswer
import com.littlemissparty.quiz.engine.SimonRound
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
import com.littlemissparty.quiz.engine.STATUES_ANNONCE_MS
import com.littlemissparty.quiz.engine.StatuesRound
import com.littlemissparty.quiz.engine.execute
import com.littlemissparty.quiz.engine.programProblem
import com.littlemissparty.quiz.engine.duelsGagnes
import com.littlemissparty.quiz.engine.gameGains
import com.littlemissparty.quiz.engine.gameStep
import com.littlemissparty.quiz.engine.nextGameTitle
import com.littlemissparty.quiz.engine.withProgram
import com.littlemissparty.quiz.tv.habillage.portraitDuel
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
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

/** Le Simon de Buzzy : ce qu'une équipe a tapé ([items]), validé ou non ([ok]), à l'heure du serveur [at]. */
data class SaisieSimon(val items: List<String>, val ok: Boolean, val at: Long?)

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

    /** Box de secours : la régie vient de lui confier la partie [code], qui s'ouvre avec ses équipes et ses points. */
    data class TakingOver(val code: String) : UiState

    /**
     * La régie a confié la partie [code] à une autre box pendant que celle-ci ne répondait plus :
     * cette box ne la pilote plus, elle le dit et ne relance rien d'elle-même.
     */
    data class Moved(val code: String) : UiState

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
        /**
         * Game Show : heure du serveur où Sarah a lancé la fin après le podium (« ▶ Lancer la fin »), null tant que la
         * musique du podium attend en boucle (et hors fin de partie).
         */
        val outroAt: Long? = null,
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
        /** Points multipliés de la question en cours (dernières questions du quiz : ×2, ×3, ×4 ou ×5), 1 sinon. */
        val factor: Int = 1,
        /** Annonce « × N » avant la première question multipliée : heure (serveur) où le chrono part ; null sinon. */
        val introUntil: Long? = null,
        /** Heure du serveur où la question s'est ouverte. */
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
        /** Les coffres mystères : les coffres du jeu en cours (null hors de ce jeu, ou avant leur installation). */
        val coffres: ChestRound? = null,
        /** Gonfleur fou : tapes reçues de chaque équipe pour la course en cours (vide hors de ce jeu). */
        val pumps: Map<String, Int> = emptyMap(),
        /** Gonfleur fou : heure du serveur du « GONFLEZ ! » (le départ 3, 2, 1 remplace le décompte de reprise). */
        val pumpGoAt: Long? = null,
        /** « Ça va exploser ! » : la bombe (qui la tient, qui l'a envoyée, durée de la mèche), null avant l'allumage. */
        val potato: PotatoRound? = null,
        /** « Ça va exploser ! » : heure du serveur où la bombe explose si l'équipe ne l'a pas envoyée (null en pause). */
        val holdUntil: Long? = null,
        /** Statues musicales : la chanson en cours (musique, statue, gagnantes), null hors de ce jeu. */
        val statues: StatuesRound? = null,
        /** Statues musicales : chansons entières déjà sur la box (chanson de la bibliothèque → fichier MP3 local). */
        val songs: Map<String, String> = emptyMap(),
        /** Le Duel des robots : le duel prêt, en cours ou jugé (l'heure du PAN, que seule la box connaît), null hors de ce jeu. */
        val duel: DuelRound? = null,
        /** Le Duel des robots : duels prévus pour que tout le monde joue, et tous les joueurs sont passés. */
        val duelTotal: Int = 0,
        val duelTousPasses: Boolean = false,
        /** Le Duel des robots : duels gagnés par chaque équipe dans ce jeu (affiches WANTED de la fin). */
        val duelGagnes: Map<String, Int> = emptyMap(),
        /** Le Duel des robots : décalage fin de l'horloge de la box avec le serveur (meilleure de 5 mesures), ou null. */
        val duelOffset: Long? = null,
        /** Le Simon de Buzzy : le tour et sa suite (la suite secrète, que seule la box connaît), null hors de ce jeu. */
        val simon: SimonRound? = null,
        /** Le Simon de Buzzy : ce que chaque équipe tape en direct pour la suite en cours (montré en « ? » à la TV). */
        val simonSaisies: Map<String, SaisieSimon> = emptyMap(),
        /** Le Simon de Buzzy : temps pour répondre (réglé dans la Régie PC) et nombre de tours. */
        val simonSec: Int = 0,
        val simonTours: Int = 0,
        /** Le Simon de Buzzy : joueurs par équipe (le joueur appelé tourne), et le dernier tour est gagné (« Jeu suivant »). */
        val simonJoueurs: Int = 0,
        val simonFini: Boolean = false,
        /** Le Chrono de Buzzy : le tour prêt, en cours ou jugé (heures des buzz comprises), null hors de ce jeu. */
        val chrono: ChronoRound? = null,
        /** Le Chrono de Buzzy : nombre de tours, le dernier est joué, et les tours gagnés par équipe. */
        val chronoTours: Int = 0,
        val chronoFini: Boolean = false,
        val chronoGagnes: Map<String, Int> = emptyMap(),
        /** Quiz : la question a été fermée par la fin du chrono, la TV annonce « TEMPS ÉCOULÉ ! » avant la réponse. */
        val tempsEcoule: Boolean = false,
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
    /** Mimes en roulement : heure du mime trouvé, tant que l'image suivante attend le nouveau devineur (sinon null). */
    val relais: Long? = null,
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
    private var duelListener: Pair<DatabaseReference, ValueEventListener>? = null
    private var simonListener: Pair<DatabaseReference, ValueEventListener>? = null
    private var chronoListener: Pair<DatabaseReference, ValueEventListener>? = null

    /** Le Simon de Buzzy : ce que les tablettes ont envoyé pour la suite en cours (clé de la suite, puis équipe). */
    private var simonSaisies: Pair<String, Map<String, SaisieSimon>>? = null

    /**
     * Le Duel des robots (cedric, 27/10 : « le timing doit être vraiment juste ») : décalage fin de l'horloge de la box
     * avec le serveur et son aller-retour (ms), la meilleure de 5 mesures ; le duel pour lequel il a été mesuré ; les
     * mesures des tablettes du face-à-face en cours (aller-retour, décalage) et le dernier duel rapporté.
     */
    private var horlogeFine: Pair<Long, Long>? = null
    private var horlogeMesuree: String? = null
    private val duelMesures = mutableMapOf<String, Pair<Long?, Long?>>()
    private var duelRapporte: String? = null

    /** Heure du serveur pour le Duel : l'horloge fine si elle est mesurée. */
    private fun duelNow() = System.currentTimeMillis() + (horlogeFine?.first ?: serverOffset)

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
    /** Dernière valeur de `regieActive` écrite pour la partie (null : rien d'écrit encore). */
    private var regieActivePubliee: Boolean? = null
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
    /**
     * Prestation de la bibliothèque chargée sur cette partie (son identifiant), publiée dans public/ : la régie
     * et les règles Firebase s'en servent pour qu'un anniversaire ne soit jamais lancé sur deux box à la fois.
     */
    private var prestation: String? = null
    /** Couleurs des équipes choisies dans la prestation (bracelets et bandeaux), publiées pour les tablettes. */
    private var couleursPrevues: List<String> = emptyList()
    /** Partie dont la box annonce la présence (hostOnline) à chaque connexion ; « hors ligne » écrit par le serveur à la coupure. */
    private var hostRef: DatabaseReference? = null
    private var hostRecheck: Job? = null
    /** Pupitres connectés au dernier relevé, et pupitres tout juste décrochés (délai de grâce en cours). */
    private var online: Set<String> = emptySet()
    private var funSeen: Map<String, Long>? = null
    private val dropTimers = mutableMapOf<String, Job>()
    /** Surveillance de la coupure Internet de la box (pause automatique d'une question en cours). */
    private var offlineWatch: Job? = null
    /** Dernier appui sur OK pris en compte (anti double appui). */
    private var lastNextAt = -NEXT_GUARD_MS
    /** Partie que la régie vient de confier au salon de cette box, en cours d'ouverture (jamais deux fois). */
    private var handoff: String? = null
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
                repriseADecider = false
                if (saved != null) {
                    when (val found = resumableGame(db, uid, saved)) {
                        is Reprise.Proposer -> {
                            announceBox(db, uid)
                            offerResume(found.offre)
                            return@launch
                        }
                        // Salon pas encore commencé : la box y revient d'elle-même, sans rien proposer (les tablettes
                        // déjà là le retrouvent seules).
                        is Reprise.Rouvrir -> {
                            announceBox(db, uid)
                            open(db, saved)
                            return@launch
                        }
                        // Partie confiée à une autre box pendant que celle-ci était éteinte : on le dit, rien ne se relance.
                        is Reprise.Deplacee -> {
                            showMoved(saved)
                            return@launch
                        }
                        // Pas d'Internet au démarrage : on ne propose rien à l'aveugle ; « Réessayer » refait ce choix.
                        is Reprise.SansReseau -> {
                            repriseADecider = true
                            _state.value = UiState.Error(SANS_RESEAU_AU_DEMARRAGE)
                            return@launch
                        }
                        Reprise.Rien -> activeCode = null
                    }
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
                val db = connect()
                FirebaseAuth.getInstance().currentUser?.uid?.let { announceBox(db, it) }
                open(db, code)
            } catch (e: Exception) {
                // Lecture refusée : la régie a confié la partie à une autre box pendant que celle-ci ne répondait plus.
                if (!showIfMoved(code)) fail(e)
            }
        }
    }

    /** « Réessayer » ne crée jamais de nouvelle partie si une partie est active. */
    fun retry() = if (activeCode != null && !repriseADecider) resume() else start()

    /** Démarrage sans Internet : la partie d'avant n'a pas encore été examinée, « Réessayer » repasse par [start]. */
    private var repriseADecider = false

    /**
     * Termine la partie active (elle reste archivée dans Firebase) et en crée une nouvelle. La partie quittée est marquée
     * (`state/leftAt`) et pointe vers la nouvelle (`state/suite`) : la régie du téléphone et les tablettes la suivent
     * seules, sans rescanner ni retaper le mot de passe (cedric, 25/10 : « il faut que ça suive tout seul »).
     */
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
                activeCode = null
                val uid = FirebaseAuth.getInstance().currentUser!!.uid
                var nouveau: String? = null
                try {
                    if (boxMayPlay(db, uid)) nouveau = createGame(db, uid)
                } finally {
                    // Même sans nouvelle partie (box à activer, base muette), l'ancienne est quittée.
                    if (previous != null) quitter(db, previous, nouveau)
                }
                nouveau?.let { open(db, it) }
            } catch (e: Exception) {
                fail(e)
            }
        }
    }

    /**
     * « Terminer la partie et quitter » (cedric, 31/10 au soir) : la partie active est marquée terminée et quittée, sans
     * en créer de nouvelle, la box l'oublie (rien ne sera proposé au prochain démarrage), puis [ensuite] ferme l'appli.
     * Hors ligne, l'écriture part au retour du réseau ; l'appli se ferme quand même au bout de [FIN_ET_QUITTER_MAX_MS].
     */
    fun terminerEtQuitter(ensuite: () -> Unit) {
        countdown?.cancel()
        timer?.cancel()
        expressTimer?.cancel()
        armTimer?.cancel()
        val code = (_state.value as? UiState.ResumeOffer)?.code ?: activeCode
        activeCode = null
        viewModelScope.launch {
            try {
                if (code != null) withTimeoutOrNull(FIN_ET_QUITTER_MAX_MS) { quitter(connect(), code, null).await() }
            } catch (e: Exception) {
                Log.w(TAG, "partie non marquée terminée avant de quitter", e)
            } finally {
                ensuite()
            }
        }
    }

    /**
     * Marque [ancien] terminée et quittée. Avec une [suite] : les téléphones reliés à la régie de l'ancienne partie le
     * sont d'abord à la nouvelle (la box est hôte des deux), puis `state/suite` est écrit, pour que la régie qui bascule
     * soit déjà reliée.
     */
    private suspend fun quitter(db: FirebaseDatabase, ancien: String, suite: String?): com.google.android.gms.tasks.Task<Void> {
        val fin = mutableMapOf<String, Any>("phase" to Phase.ENDED.code, "endedAt" to ServerValue.TIMESTAMP, "leftAt" to ServerValue.TIMESTAMP)
        if (suite != null) {
            try {
                val regies = db.getReference("games/$ancien/regie").readOnce()?.children?.toList().orEmpty()
                    .mapNotNull { r -> r.key?.let { it to (r.child("via").getValue(String::class.java) ?: "pin") } }
                if (regies.isNotEmpty()) {
                    withTimeoutOrNull(8000L) {
                        db.getReference("games/$suite").updateChildren(
                            regies.associate { (cle, via) -> "regie/$cle" to mapOf("pairedAt" to ServerValue.TIMESTAMP, "via" to via) }
                        ).await()
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "régie non recopiée vers $suite", e)
            }
            fin["suite"] = suite
        }
        // Sans attendre : hors ligne, l'écriture part au retour du réseau.
        return db.getReference("games/$ancien/state").updateChildren(fin)
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

    /**
     * Partie reprise : jamais bloquée (le verrou n'agit pas en pleine partie), mais la box envoie quand
     * même sa demande, sinon une box qui reprend toujours sa partie n'apparaît jamais dans la Régie PC.
     */
    private fun announceBox(db: FirebaseDatabase, uid: String) {
        viewModelScope.launch {
            runCatching {
                watchBox(db, uid)
                if (boxOk == uid) return@runCatching
                if (db.getReference("boxes/allowed/$uid").readOnce()?.exists() == true) {
                    boxOk = uid
                } else {
                    requestActivation(db, uid)
                }
            }.onFailure { Log.e(TAG, "Demande d'activation non envoyée", it) }
        }
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
        val idle = s is UiState.Error || s is UiState.Moved ||
            (s is UiState.Playing && (s.phase == Phase.ENDED || (s.phase == Phase.LOBBY && s.teams.isEmpty())))
        if (!idle) return
        activeCode = null
        showLock()
    }

    private fun fail(e: Exception) {
        Log.e(TAG, "Erreur", e)
        _state.value = UiState.Error(e.message ?: e.javaClass.simpleName)
    }

    /**
     * Que faire au démarrage de la partie [code] mémorisée (voir [decisionReprise]) : la proposer, y revenir sans rien
     * demander, dire qu'elle est partie sur une autre box, attendre Internet, ou l'oublier.
     */
    private suspend fun resumableGame(db: FirebaseDatabase, uid: String, code: String): Reprise {
        // Juste ce qu'il faut pour décider : jamais les médias de la partie (voir [CLES_REPRISE]). Box qui vient de
        // démarrer, Wi-Fi pas encore là : on patiente (3 lectures, près d'une minute) avant de décider.
        val read = runCatching { db.getReference("games/$code").lirePartie(listOf("hostUid", "state", "teams", "createdAt", "hostOnline"), essais = 3) }
        // Lecture refusée : cette box n'est plus l'hôte de la partie (confiée à une autre box, données effacées, autre compte).
        if (read.exceptionOrNull()?.message?.contains("ermission") == true) return movedTo(db, uid, code)
        // Sans réseau ni copie locale : rien n'est proposé à l'aveugle (cedric, 31/10 : la box démarrée sans Wi-Fi
        // proposait de reprendre une partie vide qu'il avait quittée).
        val partie = read.getOrNull() ?: return Reprise.SansReseau
        if (partie.child("hostUid").getValue(String::class.java) != uid) return movedTo(db, uid, code)
        val vueA = listOfNotNull(
            partie.child("hostOnline/at").getValue(Long::class.java), partie.child("createdAt").getValue(Long::class.java),
        ).maxOrNull()
        return when (decisionReprise(partie.child("state/phase").getValue(String::class.java), vueA, System.currentTimeMillis() + serverOffset)) {
            Reprise.Rien -> Reprise.Rien
            Reprise.Rouvrir -> Reprise.Rouvrir
            else -> Reprise.Proposer(
                UiState.ResumeOffer(code, partie.child("teams").children.mapNotNull { it.child("name").getValue(String::class.java) }, AUTO_RESUME_SECONDS),
            )
        }
    }

    private suspend fun movedTo(db: FirebaseDatabase, uid: String, code: String): Reprise =
        if (movedAway(db, uid, code)) Reprise.Deplacee else Reprise.Rien

    /**
     * La partie [code] a été confiée par la régie à une autre box, et c'est bien cette box-ci qui a été remplacée.
     * `hostUid` reste lisible quand la partie ne l'est plus ; `takeover/from` ne se lit que par la box remplacée.
     * Une box qui garde le code d'une fête qu'elle n'a jamais tenue (mémoire restaurée, identifiant perdu) n'est pas
     * concernée : elle oublie ce code et crée sa propre partie, sans rien annoncer.
     * Lu sur le serveur si possible : la copie locale de la box peut dater d'avant le changement.
     */
    private suspend fun movedAway(db: FirebaseDatabase, uid: String, code: String): Boolean {
        val host = readFresh(db.getReference("games/$code/hostUid"))?.getValue(String::class.java)
        if (host == null || host == uid) return false
        return readFresh(db.getReference("games/$code/takeover/from"))?.getValue(String::class.java) == uid
    }

    /** Valeur du serveur, à défaut la copie locale ; null si la lecture est refusée. */
    private suspend fun readFresh(ref: DatabaseReference): DataSnapshot? =
        runCatching { withTimeoutOrNull(MOVED_CHECK_MS) { ref.get().await() } ?: ref.readOnce() }.getOrNull()

    /** Reprise impossible : si la partie [code] a été confiée à une autre box, l'écran le dit au lieu d'une erreur. */
    private suspend fun showIfMoved(code: String): Boolean {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return false
        if (!movedAway(FirebaseDatabase.getInstance(databaseUrl()), uid, code)) return false
        showMoved(code)
        return true
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

    /**
     * Ouvre une partie : relit le journal, reconstruit l'état, reprend là où on en était.
     * [given] : la partie déjà lue sur le serveur (partie confiée par la régie à cette box de secours).
     */
    private suspend fun open(db: FirebaseDatabase, code: String, given: PartieLue? = null) {
        stopListening()
        timer?.cancel()
        expressTimer?.cancel()
        armTimer?.cancel()
        handoff = null
        val ref = db.getReference("games/$code")
        gameRef = ref
        soundMarks.clear()
        // Chansons entières : relues dans la partie ouverte (même chanson, peut-être redéposée depuis).
        songFiles.clear()
        // Partie rouverte ou relue : les corrections du journal ne se rejouent jamais à l'écran.
        coups.vider()
        _coup.value = null
        activeCode = code
        val partie = given ?: ref.lirePartie()
            ?: error("La base Firebase ne répond pas. Vérifiez Internet puis réessayez.")
        // Programme en vigueur, écrit par la box elle-même (prestation et modifications acceptées) ;
        // à défaut (partie d'une version plus ancienne), la prestation chargée par la régie et acceptée.
        val program = partie.child("conducteur").takeIf { it.child("id").value != null && it.child("rev").value != null }
            ?.let { c -> runCatching { QuizJson.fromValue(c.value) }.getOrNull()?.let { it to c.child("rev").getValue(String::class.java)!! } }
        val show = partie.child("show")
        val showApplied = show.child("id").value != null &&
            partie.child("showStatus/id").value == show.child("id").value &&
            partie.child("showStatus/status").getValue(String::class.java) == "applied"
        val quiz = program?.first
            ?: (if (showApplied) runCatching { QuizJson.fromValue(show.child("quiz").value) }.getOrNull() else null)
            ?: loadQuiz(partie.child("quizId").getValue(String::class.java))
        programRev = program?.second ?: if (showApplied) show.child("id").getValue(String::class.java)!! else "initial"
        val named = program != null || showApplied
        // Prestation publiée par la box elle-même ; à défaut (partie d'une version plus ancienne), celle chargée par la régie.
        prestation = partie.child("public/prestation").getValue(String::class.java)
            ?: show.child("prestation").getValue(String::class.java)?.takeIf { showApplied && show.child("base").value == null }
        couleursPrevues = couleursValides(partie.child("public/teamColors").children.map { it.value })
            .ifEmpty { if (showApplied) couleursValides(show.child("teamColors").children.map { it.value }) else emptyList() }
        judgedShow = partie.child("showStatus/id").getValue(String::class.java)
        val history = partie.child("log").children.mapNotNull { (it.value as? Map<*, *>)?.let(Codec::decode) }
        val g = Game(quiz, history)
        game = g
        val round = partie.child("state/round").getValue(Int::class.java) ?: 1
        // Commandes de la régie déjà traitées avant un redémarrage : jamais appliquées deux fois.
        handledCommands.clear()
        partie.child("commandStatus").children.mapNotNullTo(handledCommands) { it.key }
        refuseBeforeTakeover(ref, partie)
        regieUids = partie.child("regie").children.mapNotNull { it.key }.toSet()
        pinFailures = partie.child("pairingLock/failures").getValue(Int::class.java) ?: 0
        pinLockedUntil = partie.child("pairingLock/until").getValue(Long::class.java) ?: 0L
        _state.value = UiState.Playing(
            code = code, joinUrl = joinUrl(code), total = quiz.questions.size, round = round,
            // Équipes connues dès l'ouverture : une commande reçue avant leur chargement est jugée correctement.
            teams = parseTeams(partie.child("teams")),
            regiePin = regiePin(code), regies = regieUids.size,
            title = if (named) quiz.title else "",
            childName = if (named) partie.child("public/childName").getValue(String::class.java)
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
     * Partie reprise sur une autre box : ce que la régie avait envoyé à l'ancienne box sans réponse (elle a vu
     * « La TV ne répond pas ») n'est jamais appliqué ici, même un « Suivant » encore valable ou un programme
     * modifié. Chacun reçoit la réponse « trop ancien », une seule fois.
     */
    private fun refuseBeforeTakeover(ref: DatabaseReference, partie: PartieLue) {
        val takeoverAt = partie.child("takeover/at").getValue(Long::class.java) ?: return
        val updates = mutableMapOf<String, Any?>()
        for (c in partie.child("commands").children) {
            val id = c.key ?: continue
            if (id in handledCommands || (c.child("at").getValue(Long::class.java) ?: 0L) > takeoverAt) continue
            handledCommands += id
            updates += statusOf(id, CommandResult(CommandStatus.REFUSED, reason = "too_old"))
        }
        val show = partie.child("show")
        val showId = show.child("id").getValue(String::class.java)
        if (showId != null && showId != judgedShow && (show.child("at").getValue(Long::class.java) ?: 0L) <= takeoverAt) {
            judgedShow = showId
            updates["showStatus"] = mapOf("id" to showId, "status" to "refused", "reason" to "too_old", "at" to ServerValue.TIMESTAMP)
        }
        if (updates.isNotEmpty()) ref.updateChildren(updates).addOnFailureListener { Log.e(TAG, "Envois d'avant le changement de box", it) }
    }

    /**
     * La régie a confié cette partie à une autre box (celle-ci ne répondait plus) : la box arrête tout, oublie
     * la partie et l'annonce. Les règles Firebase ne la laissent de toute façon plus rien lire ni écrire.
     */
    private fun onMoved(code: String) {
        if (gameRef?.key != code) return
        showMoved(code)
    }

    private fun showMoved(code: String) {
        Log.w(TAG, "Partie $code confiée à une autre box")
        countdown?.cancel()
        timer?.cancel()
        expressTimer?.cancel()
        armTimer?.cancel()
        stopListening()
        game = null
        gameRef = null
        coups.vider()
        _coup.value = null
        if (activeCode == code) activeCode = null
        _state.value = UiState.Moved(code)
    }

    /**
     * Box de secours : la régie a confié la partie [target] au salon [lobby] de cette box, dans la même écriture
     * que le changement d'hôte (vérifié par les règles). Seulement depuis un salon encore vide ; la box relit la
     * partie sur le serveur (jamais une vieille copie locale), termine son salon puis l'ouvre comme une reprise.
     */
    private fun onHandoff(db: FirebaseDatabase, lobby: DatabaseReference, target: String) {
        val g = game ?: return
        val code = lobby.key ?: return
        if (handoff != null || gameRef?.key != code) return
        if (g.state.phase != Phase.LOBBY || g.state.index >= 0 || teams().isNotEmpty() || programRev != "initial") {
            Log.w(TAG, "Partie $target refusée : le salon $code n'est plus vide")
            return
        }
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        handoff = target
        viewModelScope.launch {
            val read = runCatching { db.getReference("games/$target").readHandedOver(code, uid, HANDOFF_WAIT_MS) }
            // Lecture refusée : la partie a déjà été confiée à une autre box. Le salon reste tel quel.
            read.exceptionOrNull()?.let {
                Log.w(TAG, "Partie $target illisible", it)
                return@launch
            }
            if (handoff != target || gameRef?.key != code) return@launch
            Log.i(TAG, "Partie $target reprise depuis le salon $code")
            _state.value = UiState.TakingOver(target)
            // D'abord le code de la partie : un redémarrage à partir d'ici rouvre la fête, jamais le salon.
            activeCode = target
            lobby.child("state").updateChildren(mapOf("phase" to Phase.ENDED.code, "endedAt" to ServerValue.TIMESTAMP))
                .addOnFailureListener { Log.e(TAG, "Salon $code non terminé", it) }
            try {
                // Serveur muet au-delà du délai : lecture ordinaire, comme une reprise.
                open(db, target, read.getOrNull())
            } catch (e: Exception) {
                fail(e)
            }
        }
    }

    /**
     * Après une reprise : une question dont le chrono a expiré pendant la coupure est fermée,
     * une question fermée mais pas encore révélée reste en attente du bouton de l'animatrice.
     */
    private fun recover() {
        val g = game ?: return
        // Coffres mystères : pas de chrono, rien ne se ferme seul.
        // Entre deux tours de mimes, rien ne se ferme seul, sauf le bilan d'une couleur quand son heure est passée.
        val entreDeuxTours = g.state.mime != null && g.state.mime?.team == null && !g.mimeBilanDue(serverNow())
        // Duel des robots : pas de chrono ; le jugement d'un face-à-face attend son heure ([schedule]).
        if (g.state.phase == Phase.QUESTION && !g.state.paused && g.question?.isCoffres != true &&
            g.question?.isDuel != true && g.question?.isSimon != true && g.question?.isChrono != true && !entreDeuxTours && g.timeOver(serverNow())
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
            // Mimes en file (cedric, 26/10) : OK sur la présentation des Mimes montre tout de suite la première image de
            // l'équipe de la couleur ; au bilan d'une couleur, OK lance la manche de la couleur suivante avec son tour.
            mimeEnFile(g)?.let { team -> commit(g.mimeStart(team, serverNow())); return@withLock }
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
                // Statues musicales : OK coupe la musique (STATUE !) ou la relance ; chanson finie : « Personne » (les
                // gagnantes se choisissent sur la régie) ; après l'annonce : chanson suivante, puis jeu suivant.
                else if (g.question?.isStatues == true) {
                    val st = g.state.statues ?: return@withLock
                    val r = st.result
                    commit(
                        when {
                            r != null -> if (serverNow() < r.at + STATUES_ANNONCE_MS) null
                            else if (st.song + 1 < g.question!!.statuesTours) g.statuesNextSong(serverNow()) else g.next(serverNow())
                            st.ended -> g.statuesSongWin(emptyList(), teams().map { it.uid }, serverNow())
                            st.dancing -> g.statuesStop(serverNow())
                            else -> g.statuesPlay(serverNow())
                        },
                    )
                }
                // Duel des robots : OK lance le duel prêt ; après un duel, prépare le suivant, ou passe au jeu suivant
                // quand tout le monde a joué (les duels à la volée se choisissent sur la régie).
                else if (g.question?.isDuel == true) {
                    val d = g.state.duel
                    val ids = teams().map { it.uid }
                    commit(
                        when {
                            d == null -> if (ids.size < 2) g.next(serverNow()) else null
                            d.enCours -> null
                            d.result == null -> g.startDuel(serverNow())
                            g.duelTousPasses(ids) -> g.next(serverNow())
                            else -> g.readyDuel(ids, serverNow())
                        },
                    )
                }
                // Chrono de Buzzy : OK lance le chrono du tour prêt, révèle quand toutes ont buzzé (comme « 👀 Révéler »),
                // puis le tour suivant ; après le dernier, le jeu suivant.
                else if (g.question?.isChrono == true) {
                    val c = g.state.chrono
                    val ids = teams().map { it.uid }
                    commit(
                        when {
                            c != null && c.revelable -> g.settleChrono(serverNow(), force = true)
                            c == null || c.enCours -> null
                            c.step == "ready" -> if (ids.isEmpty()) null else g.startChrono(ids, serverNow())
                            g.chronoFini -> g.next(serverNow())
                            else -> g.readyChrono(serverNow())
                        },
                    )
                }
                // Simon de Buzzy : OK lance la suite (ou le tour suivant) ; après le dernier tour, passe au jeu suivant.
                else if (g.question?.isSimon == true) {
                    val r = g.state.simon
                    val ids = teams().map { it.uid }
                    commit(
                        when {
                            r == null -> if (ids.isEmpty()) g.next(serverNow()) else null
                            r.enCours -> null
                            g.simonFini -> g.next(serverNow())
                            else -> g.simonGo(ids, serverNow())
                        },
                    )
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

    /** Statues musicales : la box a joué la chanson [song] jusqu'au bout ; Sarah choisit les gagnantes. */
    fun statuesSongEnded(song: Int) = act { it.statuesSongEnded(song, serverNow()) }

    /**
     * Le Duel des robots : l'image du PAN vient d'être envoyée à l'écran ; la box juge les buzz par rapport à cet
     * instant (heure du serveur, horloge fine), pris tout de suite, avant de passer la main.
     */
    fun duelPanShown() {
        val vu = duelNow()
        act { it.duelPanShown(vu, serverNow()) }
    }

    /**
     * Le Chrono de Buzzy : l'image où le chrono part de 0 vient d'être envoyée à l'écran ; la box mesure les buzz depuis
     * cet instant (heure du serveur, horloge fine), pris tout de suite.
     */
    fun chronoShown() {
        val vu = duelNow()
        act { it.chronoShown(vu, serverNow()) }
    }

    /** Duel des robots : 5 mesures de l'écart entre l'horloge de la box et celle du serveur ; la plus courte gagne. */
    private fun mesurerHorloge(cle: String) {
        if (horlogeMesuree == cle) return
        horlogeMesuree = cle
        val ref = gameRef?.child("horloge")?.child("box") ?: return
        viewModelScope.launch {
            val mesures = mutableListOf<Pair<Long, Long>>()
            repeat(5) {
                runCatching {
                    val p0 = System.currentTimeMillis()
                    withTimeoutOrNull(3_000L) { ref.setValue(mapOf("at" to ServerValue.TIMESTAMP)).await() } ?: return@runCatching
                    val p1 = System.currentTimeMillis()
                    val serveur = withTimeoutOrNull(3_000L) { ref.child("at").get().await() }?.getValue(Long::class.java) ?: return@runCatching
                    mesures += (serveur - (p0 + p1) / 2) to (p1 - p0)
                }
            }
            val m = mesures.minByOrNull { it.second } ?: return@launch
            val ancienne = horlogeFine
            if (ancienne == null || m.second < ancienne.second || kotlin.math.abs(m.first - ancienne.first) > m.second / 2 + 30) horlogeFine = m
            Log.i(TAG, "Horloge fine du duel : décalage ${m.first} ms (Firebase $serverOffset ms), aller-retour ${m.second} ms")
            updatePlaying { it.copy(duelOffset = horlogeFine?.first) }
        }
    }

    /**
     * Rapport de la box après chaque duel (cedric, 27/10 : prouver que le plus rapide gagne) : retard d'affichage du
     * PAN, pour chaque équipe (identifiant seulement) l'appui depuis le PAN affiché, l'arrivée, l'aller-retour et le
     * décalage de son horloge ; l'horloge de la box. Jamais de nom d'équipe.
     */
    private fun rapportDuel(d: DuelRound) {
        val pan = d.panAt ?: return
        val ref = d.reference ?: pan
        val r = d.result ?: return
        val equipes = d.buzzes.joinToString(" ; ") { b ->
            val (rtt, o) = duelMesures[b.team] ?: (null to null)
            "${b.team.take(6)} appui ${b.t - ref} ms, arrivé ${b.at - ref} ms, aller-retour ${rtt ?: "?"} ms, décalage ${o ?: "?"} ms"
        }.ifBlank { "aucun buzz" }
        val box = horlogeFine?.let { "décalage ${it.first} ms (Firebase $serverOffset), aller-retour ${it.second} ms" } ?: "Firebase $serverOffset ms"
        val bilan = when {
            r.early != null -> "trop tôt ${r.early!!.take(6)}"
            r.winner != null -> "gagnante ${r.winner!!.take(6)} en ${r.ms} ms"
            else -> "personne"
        }
        Reactivite.noter("pan affiché", (d.shownAt ?: pan) - pan)
        val db = gameRef?.database ?: return
        runCatching {
            CrashReporter.report(db, "duel", "duel ${d.n} : PAN affiché ${d.shownAt?.let { "${it - pan} ms" } ?: "inconnu"} après l'heure prévue ; $equipes ; box $box ; $bilan")
        }
    }

    /** Blind test à la télécommande : révéler sans gagnant, passer le morceau. */
    fun blindReveal() = act { it.blindReveal(serverNow()) }
    fun blindSkip() = act { it.blindSkip(serverNow()) }

    /** Les coffres mystères, à la télécommande (pas de régie) : un coffre au hasard pour l'équipe qui joue. */
    fun chestRandom() = act { it.openRandomChest(serverNow()) }

    /** « Ça va exploser ! », à la télécommande (pas de régie) : la bombe part au hasard chez une équipe permise. */
    fun potatoRandom() = act { it.passPotatoRandom(serverNow()) }

    fun togglePause() = act { g -> if (g.state.paused) g.resume(serverNow()) else g.pause(serverNow()) }

    /**
     * Mimes à la télécommande : lancer le tour de [team] (null : l'équipe de la couleur de la manche, sinon celle qui a
     * le moins joué).
     */
    fun mimeStart(team: String?) = act { g ->
        (team ?: equipeDeLaCouleur(g.question?.couleur)?.uid ?: g.nextMimeTeam(teams().map { it.uid }))?.let { g.mimeStart(it, serverNow()) }
    }

    /** L'équipe inscrite de la couleur [couleur] (« #F5D000 »), ou null. */
    private fun equipeDeLaCouleur(couleur: String?): Team? = couleur?.let { c -> teams().firstOrNull { it.color.equals(c, ignoreCase = true) } }

    /**
     * Mimes en file (cedric, 26/10), une manche par couleur : l'équipe dont le tour part au bouton principal, ou null.
     * Sur la présentation des Mimes ou au début de la manche : celle de sa couleur. Au bilan des scores d'une couleur :
     * celle de la couleur suivante (sa manche s'ouvre avec son tour). Sans équipe de cette couleur : rien de spécial.
     */
    private fun mimeEnFile(g: Game): String? {
        val s = g.state
        val q = g.question ?: return null
        if (s.paused || !q.isMime || q.couleur == null) return null
        return when {
            s.phase == Phase.QUESTION && (s.intro || (s.mime?.team == null && s.mime?.turns?.isEmpty() == true)) -> equipeDeLaCouleur(q.couleur)?.uid
            s.phase == Phase.SCORES && s.leaveTo == null -> g.quiz.questions.getOrNull(s.index + 1)
                ?.takeIf { it.isMime && it.roundTitle == q.roundTitle }?.couleur?.let { equipeDeLaCouleur(it)?.uid }
            else -> null
        }
    }

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

    /**
     * « Image suivante » à la télécommande. Juste après « Trouvé ! », le bouton prend le focus : un double clic sur OK
     * ne montre pas l'image avant que le nouveau devineur soit dos à l'écran.
     */
    fun mimePass() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastNextAt < NEXT_GUARD_MS) return
        lastNextAt = now
        act { it.mimePass(serverNow()) }
    }

    /** « ⏭ Passer » à la télécommande : le mimeur abandonne son image, les joueurs tournent. */
    fun mimeSkip() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastNextAt < NEXT_GUARD_MS) return
        lastNextAt = now
        act { g -> if (g.justStarted(serverNow())) null else g.mimeSkip(serverNow()) }
    }

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
            ((event as? QuestionOpened)?.let { mapOf("answers/${it.qid}" to null) } ?: emptyMap())
        // Sans réseau, Firebase garde l'écriture en file d'attente et l'envoie au retour de la connexion.
        ref.updateChildren(
            mapOf(
                "log/${Codec.key(event.seq)}" to clean(Codec.encode(event)),
                "state" to clean(Codec.publicState(g, round, teams().map { it.uid })),
            ) + replayed + extra
        ).addOnFailureListener { Log.e(TAG, "Écriture refusée", it) }
        refresh()
        schedule()
    }

    private fun publishState() {
        val g = game ?: return
        val round = (_state.value as? UiState.Playing)?.round ?: 1
        gameRef?.child("state")?.setValue(clean(Codec.publicState(g, round, teams().map { it.uid })))
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
        // Fin du chrono, ou (« Ça va exploser ! ») bombe gardée plus de 2 secondes.
        val deadline = g.wakeAt() ?: return
        timer = viewModelScope.launch {
            // Réveil trop tôt (heure du serveur corrigée entre-temps) : on attend encore, sans jamais abandonner.
            while (game === g && g.wakeAt() == deadline) {
                delay((deadline - serverNow() + CLOSE_GRACE_MS).coerceAtLeast(100))
                val done = actions.withLock {
                    val now = serverNow()
                    // Bombe gardée trop longtemps par une équipe dont la tablette vient de se couper : jamais sa faute, on
                    // attend la pause automatique (après la reprise, l'équipe a de nouveau 2 secondes) ou son retour.
                    val coupee = g.remainingMs(now) > 0 && g.state.potato?.holder?.let { it !in online } == true
                    // Quiz : « TEMPS ÉCOULÉ ! » affiché, la réponse se révèle seule (cedric, 27/10).
                    val revelation = g.revelationAutoAt()
                    if (revelation != null) {
                        if (now >= revelation) {
                            commit(g.reveal(now, collectAnswers()))
                            true
                        } else g.wakeAt() != deadline
                    } else if (g.question?.isSimon == true) {
                        val due = g.simonJugeAt()
                        if (due != null && now >= due) {
                            commit(g.judgeSimon(reponsesSimon(g), now))
                            true
                        } else g.wakeAt() != deadline
                    } else if (g.state.phase == Phase.QUESTION && !g.state.paused && g.timeOver(now) && !coupee) {
                        // Fin de la question, ou fin du tour de mimes.
                        // Gonfleur fou : au bout du chrono de secours, le plus gros ballon gagne.
                        commit(g.timeUp(serverNow()) ?: g.balloon(pumps, teams().map { it.uid }, serverNow(), stop = true))
                        true
                    } else g.wakeAt() != deadline
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
                outroAt = s.outroAt,
                deadline = g.deadline(),
                tempsEcoule = g.tempsEcoule(),
                // « Ça va exploser ! » : la mèche tirée au sort remplace la durée de la question.
                remainingMs = q?.let { g.durationOf(it) - s.elapsedAt(Long.MAX_VALUE) }?.coerceAtLeast(0) ?: 0,
                awards = revealedAwards,
                scores = s.scores(),
                buzzTeam = s.buzz?.team,
                buzzBlocked = s.buzz?.blocked.orEmpty(),
                blind = q?.takeIf { it.isBlind && s.phase != Phase.LOBBY }?.let { blindUi(g) },
                coffres = g.chestRound.takeIf { s.phase != Phase.LOBBY },
                // Tableau des scores à la fin d'un jeu (ou d'un jeu quitté en cours de route) : les jauges montent de TOUT
                // ce que le jeu a rapporté (toutes ses questions, mimes, coffres, bonus et malus de la régie), pas
                // seulement de la dernière question (cedric, 1/11 au soir : 100 points gagnés au premier mot de Chante le
                // mot, jeu quitté au troisième, qui ne montaient pas dans la jauge). Entre deux questions d'un même jeu :
                // les points de la question qui vient de se jouer.
                lastGain = when {
                    s.phase == Phase.SCORES && (g.nextGameTitle() != null || g.isLastQuestion) -> g.gameGains()
                    q?.isTurns == true -> mimeCounts.mapValues { it.value * s.pointsPerFound(q.id) }
                    else -> revealedAwards.mapValues { it.value.points }
                },
                isLast = g.isLastQuestion && g.leaveTarget == null,
                nextGame = g.nextGameTitle(),
                etape = g.gameStep()?.label,
                intro = s.intro,
                gameTitle = g.gameStep()?.title,
                factor = g.factorOf(s.index),
                introUntil = g.multiplierIntroUntil(),
                pumpGoAt = g.pumpGoAt,
                potato = s.potato.takeIf { q?.isPatate == true && s.phase != Phase.LOBBY },
                holdUntil = g.holdDeadline(),
                statues = s.statues.takeIf { q?.isStatues == true && s.phase != Phase.LOBBY },
                duel = s.duel.takeIf { q?.isDuel == true && s.phase != Phase.LOBBY },
                duelTotal = if (q?.isDuel == true) g.duelsAPrevoir(teams().map { it.uid }) else 0,
                duelTousPasses = q?.isDuel == true && g.duelTousPasses(teams().map { it.uid }),
                duelGagnes = if (q?.isDuel == true) g.duelsGagnes() else emptyMap(),
                chrono = s.chrono.takeIf { q?.isChrono == true && s.phase != Phase.LOBBY },
                chronoTours = q?.chronoTours ?: 0,
                chronoFini = q?.isChrono == true && g.chronoFini,
                chronoGagnes = if (q?.isChrono == true) g.chronoGagnes() else emptyMap(),
                simon = s.simon.takeIf { q?.isSimon == true && s.phase != Phase.LOBBY },
                simonSaisies = simonSaisies?.takeIf { (cle, _) -> cle == Codec.simonKey(g) }?.second.orEmpty(),
                simonSec = q?.simonSec ?: 0,
                simonTours = q?.simonTours ?: 0,
                simonJoueurs = q?.joueurs ?: 0,
                simonFini = q?.isSimon == true && g.simonFini,
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
                        relais = m?.takeIf { it.team != null }?.relais,
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
        // Les coffres mystères : coffres installés dès le lancement du jeu, puis le choix de la tablette de l'équipe qui joue.
        if (g.needsChests() && teams().isNotEmpty()) {
            act { it.dealChests(teams().sortedBy { t -> t.joinedAt }.map { t -> t.uid }, serverNow()) }
        }
        watchChest(Codec.chestKey(g)?.takeIf { !s.paused })
        // Gonfleur fou : les tapes des tablettes, de la course au bilan (les ballons restent à leur taille).
        watchPumps(Codec.pumpKey(g))
        // « Ça va exploser ! » : la box allume la mèche dès le lancement du jeu (équipe de départ et durée tirées au sort),
        // puis écoute l'envoi de la tablette de l'équipe qui tient la bombe.
        if (g.needsPotato() && teams().size >= 2) act { it.lightPotato(teams().map { t -> t.uid }, serverNow()) }
        watchPotato(Codec.potatoKey(g)?.takeIf { !s.paused })
        // Duel des robots : la box prépare le premier duel dès le lancement du jeu (« la ronde »), puis écoute les buzz
        // des 2 équipes pendant chaque face-à-face.
        if (g.needsDuel() && teams().size >= 2) act { it.readyDuel(teams().map { t -> t.uid }, serverNow()) }
        watchDuel(Codec.duelKey(g))
        // Simon de Buzzy : la box prépare le premier tour dès le lancement du jeu, puis écoute ce que tapent les tablettes
        // pendant chaque suite.
        if (g.needsSimon() && teams().isNotEmpty()) act { it.readySimon(teams().map { t -> t.uid }, serverNow()) }
        watchSimon(Codec.simonKey(g))
        // Chrono de Buzzy : les buzz des équipes pendant chaque tour ; l'horloge fine se mesure pendant que le tour est prêt.
        watchChrono(Codec.chronoKey(g))
        s.chrono?.takeIf { q?.isChrono == true && it.step == "ready" }?.let { mesurerHorloge("${s.qid}-chrono-${it.tour}") }
        s.duel?.takeIf { q?.isDuel == true }?.let { d ->
            // Pendant que les joueurs se placent : l'horloge de la box est recalée finement sur celle du serveur.
            if (d.step == "ready") mesurerHorloge("${s.qid}-${d.n}")
            d.result?.let { r -> "${s.qid}-${d.n}-${r.at}".takeIf { it != duelRapporte }?.let { duelRapporte = it; rapportDuel(d) } }
        }
        // Jeux au buzzer : la question ne se ferme plus quand toutes les équipes se sont trompées, elles rebuzzent 3 s après
        // le verdict (cedric, 25/10, règle 2) ; le chrono, ou l'animatrice, la termine.
        // Photo de la question en cours et de la suivante chargées d'avance (dès le salon d'attente pour la
        // première) : la révélation, ou le Zoom mystère, ne l'attend jamais. Bilan d'un jeu quitté : le jeu choisi.
        val suivante = g.quiz.questions.getOrNull(g.leaveTarget ?: (s.index + 1))
        listOfNotNull(q?.imageId.takeIf { s.phase != Phase.LOBBY }, suivante?.imageId).forEach(::prefetchImage)
        // Réponses en images : celles de la question en cours et de la suivante (lisibles aussi par les pupitres).
        listOfNotNull(q, suivante).flatMap { it.choiceImages }.filterNotNull()
            .forEach { prefetchImage(it, "choiceImages") }
        // Pictionary : photos des mots proposés (rangées avec les réponses en images), prêtes pour la révélation.
        (g.offerCards + listOfNotNull(g.lastCard)).mapNotNull { it.imageId }.forEach { prefetchImage(it, "choiceImages") }
        // Mimes et Qui a disparu ? en photos : la carte montrée et les deux suivantes ; toute la grille de la
        // question en cours et de la suivante.
        val cartesMime = s.mime?.deck.orEmpty().take(3).mapNotNull { q?.cards?.getOrNull(it) }
        val grilles = listOfNotNull(q, suivante).filter { it.isDisparu }.flatMap { it.cards }
        cartesMime.mapNotNull { it.imageId }.forEach { prefetchImage(it, "choiceImages", PHOTO_CARTE_MIMES) }
        grilles.mapNotNull { it.imageId }.forEach { prefetchImage(it, "choiceImages", PHOTO_CARTE_DISPARU) }
        // Photos : toutes celles du programme gardées sur la box, pour une fête qui continue sans Internet.
        savePhotos(g)
        // Extraits musicaux : tous ceux du programme, dès son chargement, pour que la musique ne dépende
        // plus du réseau une fois la partie lancée.
        programSounds(g.quiz).forEach(::prefetchSound)
        programSongs(g.quiz).forEach(::prefetchSong)
        // Ménage du cache des médias de la box, au salon d'attente ou à la fin seulement.
        rangerMedias()
        // Prestations du jour copiées d'avance (cedric, 30/10) : seulement quand le robot dort à l'accueil d'une box
        // acceptée, avant que Sarah charge une prestation ; ensuite le réseau est à la partie.
        val db = gameRef?.database
        if (db != null && s.phase == Phase.LOBBY && g.quiz.id == DEFAULT_QUIZ && boxOk != null) {
            prechargeur.accueil(viewModelScope, db)
        } else {
            prechargeur.arreter()
        }
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

    /**
     * La régie voit, média par média, si la box l'a bien avant de le lancer : extraits et chansons, et depuis le 1/11
     * les photos du programme (voyants du conducteur, cedric 31/10 : ils ne suivaient que les musiques).
     */
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
        val dir = medias.extraits
        val file = medias.extrait(id)
        if (file.isFile && file.length() > 0) {
            // Déjà sur la box (partie précédente, redémarrage) : il resservira, le ménage le garde plus longtemps.
            medias.toucher(file)
            return publishSound(id, file)
        }
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

    /** Statues musicales : chansons entières déjà sur la box (chanson → fichier), nom de chacune dans le cache. */
    private val songFiles = mutableMapOf<String, String>()
    private val songKeys = mutableMapOf<String, String>()
    private val songsLoading = mutableSetOf<String>()

    /**
     * Statues musicales : copie une chanson entière de la partie (games/<code>/songs/<chanson>, copiée par la régie
     * depuis la bibliothèque) dans le cache de la box. La régie écrit `n` en dernier : la box attend qu'il soit là. Le
     * nom dans le cache porte sa taille et son débit : une chanson redéposée dans la bibliothèque est recopiée. Absente
     * ou abîmée : la TV joue l'extrait de la chanson.
     */
    private fun prefetchSong(songId: String) {
        if (songId in songFiles) {
            if ((_state.value as? UiState.Playing)?.songs?.containsKey(songId) == false) updatePlaying { it.copy(songs = songFiles.toMap()) }
            return
        }
        val ref = gameRef ?: return
        if (!songsLoading.add(songId)) return
        viewModelScope.launch {
            val file = runCatching { telechargerChanson(ref.child("songs/$songId"), songId) }
                .onFailure { Log.w(TAG, "Statues : chanson entière $songId illisible", it) }.getOrNull()
            songsLoading -= songId
            if (gameRef != ref) return@launch
            if (file == null) return@launch run { Log.w(TAG, "Statues : chanson entière $songId absente, l'extrait la remplace") }
            songFiles[songId] = file.absolutePath
            updatePlaying { it.copy(songs = songFiles.toMap()) }
        }
    }

    private suspend fun telechargerChanson(node: DatabaseReference, songId: String): java.io.File? {
        val n = (node.child("n").readWhenPresent(SONG_WAIT_MS)?.value as? Number)?.toInt()?.takeIf { it in 1..24 } ?: return null
        val length = (node.child("length").readWhenPresent(PHOTO_WAIT_MS)?.value as? Number)?.toLong() ?: 0L
        val kbps = (node.child("kbps").readWhenPresent(PHOTO_WAIT_MS)?.value as? Number)?.toLong() ?: 0L
        val cle = Prechargeur.cleChanson(songId, n, length, kbps)
        songKeys[songId] = cle
        val file = medias.extrait(cle)
        if (kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { file.isFile && file.length() > 0 }) {
            medias.toucher(file)
            return file
        }
        val part = java.io.File(medias.extraits, "$cle.part")
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { medias.extraits.mkdirs(); part.delete() }
        // Parts lues une à une et décodées au fil de l'eau (base64 recollé sur 4 caractères) : jamais toute la chanson en mémoire.
        var reste = ""
        for (i in 0 until n) {
            val data = node.child("p/$i").readWhenPresent(PHOTO_WAIT_MS)?.getValue(String::class.java) ?: return null
            val tout = reste + data
            val utile = tout.length - tout.length % 4
            val octets = Base64.decode(tout.substring(0, utile), Base64.DEFAULT)
            reste = tout.substring(utile)
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { part.appendBytes(octets) }
        }
        return kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            if (reste.isNotEmpty() || part.length() == 0L || !part.renameTo(file)) { part.delete(); null } else file
        }
    }

    private fun publishSound(id: String, file: java.io.File) {
        soundsLoading -= id
        soundFiles[id] = file.absolutePath
        markSound(id, "ok")
        updatePlaying { it.copy(sounds = soundFiles.toMap()) }
    }

    private val imageBytes = object : LinkedHashMap<String, ByteArray>(8, 0.75f, true) {
        // Quelques dizaines de photos seulement en mémoire (moins de 50 Ko chacune) : la box ancienne a peu de place,
        // mais deux grilles de Qui a disparu ? en photos doivent y tenir.
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ByteArray>?) = size > 32
    }
    private val imagesLoading = mutableSetOf<String>()

    /**
     * Lit une photo d'illustration : d'abord sur la box (gardée dès le chargement du programme), sinon dans la
     * partie. Absente, abîmée ou hors connexion sans copie : la question reste sans photo.
     */
    private fun prefetchImage(id: String, dir: String = "images", cible: Int = PHOTO_PLEINE) {
        // Décodée d'avance en fond, à la taille de son écran : la question s'affiche sans attendre la photo.
        imageBytes[id]?.let { return Photos.prechauffer(it, cible) }
        if (!imagesLoading.add(id)) return
        val ref = gameRef ?: return run { imagesLoading -= id }
        viewModelScope.launch {
            val bytes = photoOnBox(id) ?: downloadPhoto(ref, dir, id)
            imagesLoading -= id
            markSound(id, if (bytes != null) "ok" else "missing")
            if (bytes == null) return@launch
            Photos.prechauffer(bytes, cible)
            imageBytes[id] = bytes
            updatePlaying { it.copy(images = imageBytes.toMap()) }
        }
    }

    /** Photos gardées sur la box (filesDir/photos/<empreinte>) : la fête garde ses images si Internet coupe. */
    private val photoDir by lazy { medias.photos }
    private var photosSavedFor: Any? = null

    private suspend fun photoOnBox(id: String): ByteArray? = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        runCatching { java.io.File(photoDir, id).takeIf { it.isFile && it.length() > 0 }?.also { medias.toucher(it) }?.readBytes() }.getOrNull()
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
     * mémoire : si Internet coupe ensuite, chaque question garde sa photo. Le ménage du cache ([rangerMedias])
     * efface les plus anciennes copies des autres fêtes (la Mi Box a peu de place).
     */
    private fun savePhotos(g: Game) {
        if (photosSavedFor === g.quiz) return
        photosSavedFor = g.quiz
        val ref = gameRef ?: return
        val wanted = programPhotos(g.quiz)
        viewModelScope.launch {
            for ((id, dir) in wanted) {
                if (gameRef != ref) return@launch
                // Déjà sur la box : elle resservira, le ménage la garde plus longtemps.
                val there = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    java.io.File(photoDir, id).takeIf { it.isFile && it.length() > 0 }?.also { medias.toucher(it) } != null
                }
                when {
                    there -> markSound(id, "ok")
                    // Déjà en route pour l'écran : elle sera marquée à son arrivée.
                    id in imagesLoading -> {}
                    else -> {
                        markSound(id, "loading")
                        markSound(id, if (downloadPhoto(ref, dir, id) != null) "ok" else "missing")
                    }
                }
            }
        }
    }

    /** Extraits musicaux du programme (blind test, quiz musical, statues) : extrait, refrain et chansons. */
    private fun programSounds(quiz: Quiz): Set<String> =
        quiz.questions.flatMapTo(LinkedHashSet()) { listOfNotNull(it.audioId, it.refrainId) + it.audioIds }

    /** Statues musicales : chansons entières du programme. */
    private fun programSongs(quiz: Quiz): Set<String> = quiz.questions.flatMapTo(LinkedHashSet()) { q -> q.songs.mapNotNull { it.songId } }

    /** Photos du programme, avec le dossier de la partie où la régie les copie. */
    private fun programPhotos(quiz: Quiz): Map<String, String> {
        val wanted = LinkedHashMap<String, String>()
        quiz.questions.forEach { q ->
            q.imageId?.let { wanted.putIfAbsent(it, "images") }
            q.choiceImages.filterNotNull().forEach { wanted.putIfAbsent(it, "choiceImages") }
            q.cards.mapNotNull { it.imageId }.forEach { wanted.putIfAbsent(it, "choiceImages") }
        }
        return wanted
    }

    // ---------- Cache des médias de la box ----------

    /** Extraits et photos gardés sur la box, retéléchargeables depuis la partie. */
    private val medias by lazy { MediasBox(getApplication<Application>().filesDir) }
    private val prechargeur by lazy { Prechargeur(medias) }
    /** Un seul ménage ou vidage du cache à la fois. */
    private val mediasLock = Mutex()
    /** Partie dont le cache a déjà été rangé : une seule fois par partie ouverte. */
    private var rangePour: String? = null
    private var rangement: Job? = null
    private val _vidage = MutableStateFlow<VidageCache>(VidageCache.Pret)

    /** « Vider le cache des médias » (menu Retour) : où en est la dernière demande. */
    val vidage: StateFlow<VidageCache> = _vidage

    /** Moment calme pour le ménage : salon d'attente ou fin de partie, aucune musique ne peut jouer. */
    private fun momentDeRangement(): Boolean =
        (_state.value as? UiState.Playing)?.phase.let { it == Phase.LOBBY || it == Phase.ENDED }

    /**
     * Ménage du cache des médias de la box ([CacheMedias][com.littlemissparty.quiz.engine.CacheMedias]) : une fois par
     * partie ouverte, au salon d'attente ou à la fin, jamais pendant une présentation, une question, une révélation
     * ou une musique. En tâche de fond, quelques millisecondes ; une erreur est notée et oubliée, la fête continue.
     */
    private fun rangerMedias() {
        val code = (_state.value as? UiState.Playing)?.code ?: return
        if (code == rangePour || rangement?.isActive == true || !momentDeRangement()) return
        rangement = viewModelScope.launch {
            // La partie s'ouvre et ses copies partent d'abord ; la partie ouverte à ce moment-là est celle rangée.
            delay(RANGEMENT_DELAI_MS)
            val g = game ?: return@launch
            val ouverte = (_state.value as? UiState.Playing)?.code ?: return@launch
            if (ouverte == rangePour || !momentDeRangement()) return@launch
            rangePour = ouverte
            val perdus = mediasLock.withLock {
                // Médias de la partie ouverte et téléchargements en cours : jamais effacés.
                // Chansons entières des statues comprises, et celles en cours de copie.
                val sons = programSounds(g.quiz) + soundsLoading + programSongs(g.quiz).mapNotNull { songKeys[it] } +
                    songsLoading.mapNotNull { songKeys[it] }
                val images = programPhotos(g.quiz).keys + imagesLoading
                val publies = soundFiles.toMap()
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    runCatching { medias.ranger(sons, images) }
                        .onSuccess { if (it.fichiers > 0) Log.i(TAG, "Cache des médias rangé : ${it.fichiers} fichier(s), ${it.octets / 1_048_576} Mo libérés") }
                        .onFailure { Log.w(TAG, "Ménage du cache des médias impossible", it) }
                    // Extraits déjà connus dont le fichier n'est plus là (autres fêtes) : à recopier s'ils resservent.
                    publies.filterValues { !java.io.File(it).isFile }.keys
                }
            }
            if (perdus.isEmpty()) return@launch
            perdus.forEach { soundFiles.remove(it) }
            updatePlaying { it.copy(sounds = soundFiles.toMap()) }
            programSounds(g.quiz).filter { it in perdus }.forEach(::prefetchSound)
        }
    }

    /**
     * « Vider le cache des médias » (menu Retour) : efface les extraits et les photos gardés sur la box, rien d'autre
     * (ni la partie, ni les scores, ni les réglages), puis recopie aussitôt ceux de la partie ouverte depuis ses
     * copies. Seulement quand aucune musique ne peut jouer, et avec Internet pour que tout revienne.
     */
    fun viderCacheMedias() {
        val s = _state.value as? UiState.Playing ?: return run { _vidage.value = VidageCache.Refuse("Aucune partie ouverte.") }
        vidageImpossible(s)?.let { _vidage.value = VidageCache.Refuse(it); return }
        if (_vidage.value == VidageCache.EnCours) return
        _vidage.value = VidageCache.EnCours
        viewModelScope.launch {
            val r = mediasLock.withLock {
                // Les téléchargements en cours se terminent normalement.
                val sonsEnCours = soundsLoading.toSet() + songsLoading.mapNotNull { songKeys[it] }
                val imagesEnCours = imagesLoading.toSet()
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { runCatching { medias.vider(sonsEnCours, imagesEnCours) } }
            }
            r.onSuccess { Log.i(TAG, "Cache des médias vidé : ${it.fichiers} fichier(s), ${it.octets / 1_048_576} Mo") }
                .onFailure { Log.e(TAG, "Cache des médias pas entièrement vidé", it) }
            // Les extraits connus n'ont plus de fichier : la partie ouverte recopie les siens et ses photos tout de suite.
            soundFiles.clear()
            songFiles.clear()
            updatePlaying { it.copy(sounds = emptyMap(), songs = emptyMap()) }
            photosSavedFor = null
            game?.let { g ->
                savePhotos(g)
                programSounds(g.quiz).forEach(::prefetchSound)
                programSongs(g.quiz).forEach(::prefetchSong)
            }
            _vidage.value = r.getOrNull()?.let { VidageCache.Fait(it) } ?: VidageCache.Echec
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
     * - Sans `base` : une prestation complète, au salon d'attente avant toute question. Partie déjà commencée
     *   (mauvaise prestation lancée) : seulement tant qu'aucun point n'a été donné ([Game.mayReplaceProgram]) ;
     *   la partie repart alors du salon d'attente avec la nouvelle prestation, les équipes restent.
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
            // Mauvaise prestation lancée : la partie a commencé, elle repartira du salon d'attente.
            val reset = base == null && !lobby
            var reason = when {
                quiz.isFailure -> "invalid".also { Log.e(TAG, "Prestation refusée", quiz.exceptionOrNull()) }
                reset && g.state.phase == Phase.ENDED -> "not_now"
                // Un point a déjà été donné : la prestation ne change plus (« Nouvelle partie » sur la TV pour repartir de zéro).
                reset && !g.mayReplaceProgram() -> "points"
                base != null && base != programRev -> "stale"
                base != null -> g.programProblem(q!!)
                else -> null
            }
            val restart = if (reason == null && reset) g.resetProgram(serverNow()) else null
            if (reset && restart == null && reason == null) reason = "points"
            val next = if (reason == null) (if (base == null) Game(q!!, g.events) else g.withProgram(q!!)) else null
            if (reason == null && next == null) reason = "invalid"
            val status = clean(mapOf("id" to id, "status" to if (reason == null) "applied" else "refused", "reason" to reason, "at" to ServerValue.TIMESTAMP))
            // Un programme refusé se lit dans les rapports de la box (test du 27/10 au soir : deux ajouts de jeu sans
            // effet sur le téléphone, et la réponse de la box effacée par l'envoi suivant). Sans titres ni noms.
            if (reason != null) gameRef?.database?.let { db ->
                CrashReporter.report(
                    db, "programme",
                    "refusé ($reason) : ${if (base == null) "prestation complète" else "modification"}, base ${base ?: "-"}, en vigueur $programRev, " +
                        "${q?.questions?.size ?: "?"} questions envoyées contre ${g.quiz.questions.size}, question ${g.state.index}, phase ${g.state.phase}${if (g.state.intro) " (présentation)" else ""}",
                )
            }
            if (next != null) {
                game = next
                programRev = id
                if (base == null) {
                    prestation = snap.child("prestation").getValue(String::class.java)
                    couleursPrevues = couleursValides(snap.child("teamColors").children.map { it.value })
                }
                updatePlaying {
                    if (base == null) it.copy(title = q!!.title, childName = snap.child("childName").getValue(String::class.java).orEmpty())
                    else it
                }
                gameRef?.child("conducteur")?.setValue(conducteur(next.quiz, programRev))
                publishPublic()
                if (restart != null) {
                    // Retour au salon : journal, état et réponse à la régie en une seule écriture (rafraîchit l'écran et
                    // relance les minuteries). Les annonces de points de l'ancien programme ne se rejouent pas.
                    coups.vider()
                    _coup.value = null
                    commit(restart, mapOf("showStatus" to status))
                    return@withLock
                }
                publishState()
                refresh()
                // Le chrono en cours était surveillé sur l'ancienne partie : on le reprend sur la nouvelle.
                schedule()
            }
            gameRef?.child("showStatus")?.setValue(status)
        } }
    }

    /**
     * Titre et prénom de l'enfant fêté, lisibles par les pupitres pour l'accueil. `changeBox` : cette box sait
     * reprendre la fête d'une box en panne ; la régie (et les règles) ne confient jamais une fête à une box plus ancienne.
     * `prestation` : la prestation de la bibliothèque jouée ici (liste des prestations de la régie, règles des lancements).
     * `teamColors` : les seules couleurs que les tablettes proposent aux équipes (bracelets et bandeaux de la prestation).
     * `look` : le design de cette TV ; les pupitres le suivent, même ouverts sans le QR (vieil onglet, cedric 26/10).
     */
    fun publierDesign() = publishPublic()

    private fun publishPublic() {
        val s = _state.value as? UiState.Playing ?: return
        val title = s.title.ifBlank { game?.quiz?.title.orEmpty() }
        gameRef?.child("public")?.setValue(
            clean(mapOf(
                "title" to title.take(120), "childName" to s.childName.take(40).ifBlank { null }, "changeBox" to true,
                "prestation" to prestation?.take(40), "teamColors" to couleursPrevues.ifEmpty { null },
                "look" to if (com.littlemissparty.quiz.tv.habillage.Look.gs) "gs" else "classique",
            ))
        )
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
            // Nom et couleur de la nouvelle équipe : choisis par l'animatrice sur la régie (cedric, 24/10).
            val nom = snap.child("name").getValue(String::class.java)
            val couleur = snap.child("color").getValue(String::class.java)
            viewModelScope.launch {
                actions.withLock { admitDevice(id, replace = type == REPLACE, device = device, team = team, nom = nom, couleur = couleur) }
            }
            return
        }
        // « 🏁 Fin de la fête » sur la régie (cedric, 23/10) : seulement une fois la partie terminée (écran « Merci
        // d'avoir participé ») ; la TV quitte la partie et revient à l'accueil, comme « Terminer et lancer une nouvelle
        // partie » du menu Retour. « ⛔ Arrêter la partie » (cedric, 29/10, avec `arret`) : à tout moment, tout
        // s'arrête tout de suite, sans podium, et la TV revient à l'accueil de la même façon.
        if (type == NEW_GAME) {
            val arret = snap.child("arret").getValue(Boolean::class.java) == true
            viewModelScope.launch {
                val fin = actions.withLock {
                    val ended = arret || game?.state?.phase == Phase.ENDED
                    val result = if (ended) CommandResult(CommandStatus.APPLIED) else CommandResult(CommandStatus.REFUSED, reason = "not_ended")
                    gameRef?.updateChildren(statusOf(id, result))?.let { runCatching { it.await() } }
                    ended
                }
                if (fin) newGame()
            }
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
     * Tablette acceptée par la régie, dès le salon d'attente comme en cours de partie (cedric, 24/10 : la tablette
     * ne tape ni ne choisit rien) : nouvelle équipe, avec le nom et la couleur que l'animatrice a choisis ([nom],
     * [couleur]), ou remplaçant d'une équipe existante, qui garde son nom, sa couleur et ses points (ils sont rangés
     * sous l'identifiant de l'équipe). Les règles Firebase n'acceptent plus rien de l'ancien appareil. La demande est
     * effacée dans la même écriture. [id] : commande de la régie, qui reçoit la réponse ; null quand l'animatrice
     * confirme à la télécommande.
     */
    private suspend fun admitDevice(
        id: String?,
        replace: Boolean,
        device: String?,
        team: String?,
        nom: String? = null,
        couleur: String? = null,
    ): String? {
        val ref = gameRef ?: return "gone"
        val request = device?.let { runCatching { ref.child("joinRequests/$it").readOnce() }.getOrNull() }?.takeIf { it.exists() }
        val teams = teams()
        // Anciennes tablettes : le nom et la couleur venaient de la demande.
        val name = (nom ?: request?.child("name")?.getValue(String::class.java))?.trim()?.take(MAX_TEAM_NAME)
        val reason = when {
            device == null || request == null -> "gone"
            teams.any { it.uid == device || it.device == device } -> "busy"
            !replace && teams.size >= MAX_TEAMS -> "full"
            replace && teams.none { it.uid == team } -> "unknown_team"
            !replace && name.isNullOrEmpty() -> "no_name"
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
                val color = freeColor(couleur ?: request.child("color").getValue(String::class.java), teams.map { it.color })
                updates["teams/$device"] = mapOf(
                    "name" to name,
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
        // Incidents du son (boucle qui s'arrête toute seule, lecteur en erreur) : dans les rapports de la box.
        com.littlemissparty.quiz.tv.habillage.Sons.rapporteur = { texte -> CrashReporter.report(db, "son", texte) }
        suivreSante(db)
        return db
    }

    private var sante: Job? = null
    @Volatile private var internet = false
    private val coupures = Coupures()

    /** Bilan de santé de la box dans ses rapports pendant la soirée (voir [SanteBox]) ; un seul suivi par lancement. */
    private fun suivreSante(db: FirebaseDatabase) {
        if (sante != null) return
        db.getReference(".info/connected").addValueEventListener(object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                internet = snapshot.getValue(Boolean::class.java) == true
            }
            override fun onCancelled(error: DatabaseError) = Unit
        })
        val depart = SystemClock.elapsedRealtime()
        sante = viewModelScope.launch {
            delay(SanteBox.PREMIER_MS)
            repeat(SanteBox.MAX_PAR_LANCEMENT) {
                runCatching { envoyerSante(db, SystemClock.elapsedRealtime() - depart) }
                    .onFailure { Log.w(TAG, "Bilan de santé non envoyé", it) }
                delay(SanteBox.CADENCE_MS)
            }
        }
    }

    private fun envoyerSante(db: FirebaseDatabase, depuisMs: Long) {
        val app = getApplication<Application>()
        val memoire = android.app.ActivityManager.MemoryInfo()
        (app.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager).getMemoryInfo(memoire)
        val rt = Runtime.getRuntime()
        val mo = 1024L * 1024
        val partie = _state.value as? UiState.Playing
        com.littlemissparty.quiz.tv.habillage.Sons.etat { boucles, sonsLongs, incidents ->
            val bilan = SanteBox(
                ramLibreMo = memoire.availMem / mo,
                ramTotaleMo = memoire.totalMem / mo,
                ramBasse = memoire.lowMemory,
                appliMo = (rt.totalMemory() - rt.freeMemory()) / mo,
                appliMaxMo = rt.maxMemory() / mo,
                disqueLibreMo = app.filesDir.usableSpace / mo,
                boucles = boucles,
                sonsLongs = sonsLongs,
                incidentsSon = incidents,
                internet = internet,
                ecran = partie?.let { p -> p.phase.code + if (p.paused) " en pause" else "" } ?: _state.value::class.simpleName.orEmpty(),
                tablettes = partie?.let { p -> p.teams.count { it.uid in p.online } } ?: 0,
                equipes = partie?.teams?.size ?: 0,
                depuisMs = depuisMs,
            )
            CrashReporter.report(db, "sante", bilan.ligne())
            // Coupures des 5 dernières minutes (cedric, 30/10) : par couleur d'équipe, jamais le nom (journal public).
            val equipes = partie?.teams.orEmpty().associateBy { it.uid }
            coupures.releve(System.currentTimeMillis()) { id ->
                if (id.startsWith(REGIE_COUPURE)) "téléphone" else equipes[id]?.let { "tablette ${portraitDuel(it.color.toColor())}" } ?: "tablette ?"
            }?.let { CrashReporter.report(db, "connexions", it) }
            // Fluidité des 5 dernières minutes : où la box a accroché (cedric, 25/10 : la Mi Box comme référence).
            Fluidite.releve()?.let { CrashReporter.report(db, "fluidite", it) }
            Reactivite.releve()?.let { CrashReporter.report(db, "fluidite", it) }
        }
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
        regieActivePubliee = null
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
            if (connected) announceHost(ref)
        }
        // Une box remplacée peut écrire « hors ligne » après coup (coupure vue tard par le serveur) : la box hôte se
        // réannonce, au plus toutes les 2 secondes (écriture refusée si la partie vient d'être confiée à une autre box).
        observe(ref.child("hostOnline")) { snap ->
            val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return@observe
            if (snap.child("online").getValue(Boolean::class.java) == true && snap.child("uid").getValue(String::class.java) == uid) return@observe
            if (hostRecheck?.isActive == true) return@observe
            hostRecheck = viewModelScope.launch {
                delay(HOST_RECHECK_MS)
                if (hostRef?.key == ref.key && (_state.value as? UiState.Playing)?.connected == true) announceHost(ref)
            }
        }
        observe(ref.child("teams")) { snap ->
            val teams = parseTeams(snap)
            updatePlaying { s ->
                s.copy(teams = teams)
            }
        }
        online = emptySet()
        observe(ref.child("presence")) { snap ->
            val maintenant = System.currentTimeMillis()
            snap.children.forEach { c -> c.key?.let { coupures.vu(it, c.child("online").getValue(Boolean::class.java) == true, maintenant) } }
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
        // Défis de la pause en plus de cette fête (régie) : ceux de la partie précédente ne suivent jamais.
        DefisPause.lire(null)
        observe(ref.child("defisFete"), DefisPause::lire)
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
        // Le téléphone de la régie signale sa présence : ses coupures vont dans les rapports, comme celles des tablettes.
        observe(ref.child("regiePresence")) { snap ->
            val maintenant = System.currentTimeMillis()
            snap.children.forEach { c ->
                c.key?.let {
                    coupures.vu(
                        REGIE_COUPURE + it, c.child("online").getValue(Boolean::class.java) == true, maintenant,
                        cachee = c.child("cachee").getValue(Boolean::class.java) ?: false,
                    )
                }
            }
        }
        observe(ref.child("regie")) { snap ->
            val uids = snap.children.mapNotNull { it.key }.toSet()
            val added = uids - regieUids
            regieUids = uids
            // Les tablettes n'entrent qu'une fois la régie ouverte (cedric, 24/10) : elles lisent ce drapeau, pas les régies.
            val active = uids.isNotEmpty()
            if (regieActivePubliee != active) {
                regieActivePubliee = active
                ref.child("regieActive").setValue(active).addOnFailureListener {
                    regieActivePubliee = null
                    Log.e(TAG, "Régie ouverte non publiée", it)
                }
            }
            // Une régie vient d'être reliée : on referme l'écran du QR code.
            updatePlaying { it.copy(regies = uids.size, showRegie = it.showRegie && added.isEmpty()) }
        }
        // « Changer de box » : la régie a confié cette partie à une autre box (lisible même quand la partie ne l'est plus).
        val uid = FirebaseAuth.getInstance().currentUser?.uid
        observe(ref.child("hostUid")) { snap ->
            val host = snap.getValue(String::class.java)
            if (uid != null && host != null && host != uid) onMoved(ref.key ?: return@observe)
        }
        // Salon d'attente de cette box : la régie vient de lui confier la partie d'une box en panne.
        observe(ref.child("handoff")) { snap ->
            snap.getValue(String::class.java)?.let { onHandoff(db, ref, it) }
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
                    // Mimes, Statues, blind test en attente, réponse orale après un buzz : pas de pause (voir pauseAutoPossible).
                    val waited = g.pauseAutoPossible(serverNow())
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
                snapshot.child("at").getValue(Long::class.java)?.let { Reactivite.noter("buzz", serverNow() - it) }
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
     * Chrono de Buzzy : les buzz des tablettes du tour en cours (games/<code>/chrono/<clé>/<équipe> = { t, at }) : [t] = heure
     * de l'appui estimée par la tablette, [at] = arrivée sur le serveur. Les règles n'acceptent qu'un buzz par équipe du
     * tour, et une clé par tour : un vieux buzz ne compte jamais.
     */
    private fun watchChrono(key: String?) {
        if (key == chronoListener?.first?.key) return
        chronoListener?.let { (r, l) -> r.removeEventListener(l) }
        chronoListener = null
        val ref = gameRef?.child("chrono")?.child(key ?: return) ?: return
        // Chaque nouveau buzz renvoie tout le tour : seul le buzz qui vient d'arriver compte dans la réactivité (avant, les
        // buzz déjà reçus étaient recomptés à chaque nouveau, avec un retard qui grandissait : 1 s de moyenne, 6 s au pire).
        val mesures = mutableSetOf<String>()
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val buzz = snapshot.children.mapNotNull { c ->
                    val at = c.child("at").getValue(Long::class.java) ?: return@mapNotNull null
                    Triple(c.key ?: return@mapNotNull null, c.child("t").getValue(Long::class.java) ?: at, at)
                }.sortedBy { it.third }
                buzz.forEach { (team, t, at) ->
                    if (mesures.add(team)) Reactivite.noter("chrono", serverNow() - at)
                    act { g ->
                        if (Codec.chronoKey(g) != key || g.state.chrono?.buzzes?.any { it.team == team } == true) null
                        else g.chronoBuzz(team, t, minOf(at, serverNow()))
                    }
                }
            }

            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Buzz du chrono : ${error.message}")
            }
        }
        chronoListener = ref to listener
        ref.addValueEventListener(listener)
    }

    /**
     * Duel des robots : les buzz des 2 tablettes du face-à-face en cours (games/<code>/duel/<clé>/<équipe> = { t, at }) :
     * [t] = heure de l'appui estimée par la tablette, [at] = arrivée sur le serveur. Les règles n'acceptent qu'un buzz par
     * équipe du duel, et une clé par face-à-face : un vieux buzz ne compte jamais. La box juge (trop tôt, plus rapide).
     */
    private fun watchDuel(key: String?) {
        if (key == duelListener?.first?.key) return
        duelListener?.let { (r, l) -> r.removeEventListener(l) }
        duelListener = null
        duelMesures.clear()
        val ref = gameRef?.child("duel")?.child(key ?: return) ?: return
        val mesures = mutableSetOf<String>()   // comme au Chrono : un buzz ne compte qu'une fois dans la réactivité
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val buzz = snapshot.children.mapNotNull { c ->
                    val at = c.child("at").getValue(Long::class.java) ?: return@mapNotNull null
                    Triple(c.key ?: return@mapNotNull null, c.child("t").getValue(Long::class.java) ?: at, at)
                }.sortedBy { it.third }
                snapshot.children.forEach { c ->
                    c.key?.let { duelMesures[it] = c.child("r").getValue(Long::class.java) to c.child("o").getValue(Long::class.java) }
                }
                buzz.forEach { (team, t, at) ->
                    if (mesures.add(team)) Reactivite.noter("duel", serverNow() - at)
                    act { g ->
                        if (Codec.duelKey(g) != key || g.state.duel?.buzzes?.any { it.team == team } == true) null
                        else g.duelBuzz(team, t, minOf(at, serverNow()))
                    }
                }
            }

            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Buzz du duel : ${error.message}")
            }
        }
        duelListener = ref to listener
        ref.addValueEventListener(listener)
    }

    /**
     * Simon de Buzzy : ce que tapent les tablettes pendant la suite en cours (games/<code>/simon/<clé>/<équipe> =
     * { items: "rouge,vert,4", ok, at }), réécrit à chaque appui jusqu'à « Valider » (ok). Les règles n'acceptent que
     * les équipes encore en jeu, pendant le chrono, et plus rien après « Valider ». La TV le montre en direct ; quand
     * toutes les équipes en jeu ont validé, la box juge sans attendre la fin du chrono.
     */
    private fun watchSimon(key: String?) {
        if (key == simonListener?.first?.key) return
        simonListener?.let { (r, l) -> r.removeEventListener(l) }
        simonListener = null
        if (key == null) simonSaisies = null
        val ref = gameRef?.child("simon")?.child(key ?: return) ?: return
        simonSaisies = key to emptyMap()
        val listener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val saisies = snapshot.children.mapNotNull { c ->
                    val team = c.key ?: return@mapNotNull null
                    val items = c.child("items").getValue(String::class.java).orEmpty().split(",").filter { it.isNotEmpty() }
                    val at = c.child("at").getValue(Long::class.java)
                    team to SaisieSimon(items, c.child("ok").getValue(Boolean::class.java) == true, at)
                }.toMap()
                simonSaisies = key to saisies
                saisies.values.mapNotNull { it.at }.maxOrNull()?.let { Reactivite.noter("simon", serverNow() - it) }
                act { g ->
                    val r = g.state.simon
                    // Toutes les équipes en jeu ont validé : la suite se juge tout de suite.
                    if (Codec.simonKey(g) != key || r == null || !g.simonReponse(serverNow()) || !r.enJeu.all { saisies[it]?.ok == true }) null
                    else g.judgeSimon(reponsesSimon(g), serverNow())
                }
                refresh()
            }

            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Réponses du Simon : ${error.message}")
            }
        }
        simonListener = ref to listener
        ref.addValueEventListener(listener)
    }

    /** Simon de Buzzy : les réponses de la suite en cours, temps pour valider compté depuis le début du chrono. */
    private fun reponsesSimon(g: Game): Map<String, SimonAnswer> {
        val depart = g.state.simon?.reponseAt ?: return emptyMap()
        val saisies = simonSaisies?.takeIf { (cle, _) -> cle == Codec.simonKey(g) }?.second.orEmpty()
        return saisies.mapValues { (_, v) -> SimonAnswer(v.items, if (v.ok) ((v.at ?: depart) - depart).coerceAtLeast(0) else null) }
    }

    /**
     * « Ça va exploser ! » : l'envoi de la tablette de l'équipe qui tient la bombe (games/<code>/potatoPass/<clé> =
     * { to, at }). Les règles de la base n'acceptent que l'appareil de cette équipe, dès la réception (cedric, 27/10), vers
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
                Reactivite.noter("bombe", serverNow() - at)
                act { g ->
                    val holder = g.state.potato?.holder
                    if (Codec.potatoKey(g) != key || holder == null) null else g.passPotato(holder, to, serverNow(), sentAt = at)
                }
            }

            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Envoi de la bombe (Ça va exploser) : ${error.message}")
            }
        }
        potatoListener = ref to listener
        ref.addValueEventListener(listener)
    }

    /**
     * Les coffres mystères : le coffre choisi par la tablette de l'équipe qui joue (games/<code>/chestChoice/<clé>). Les
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
                Log.e(TAG, "Coffre choisi (Coffres mystères) : ${error.message}")
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
        // Délai tablette → box de chaque paquet en direct (heure de la tablette lue dans sa clé), pour les rapports ; pas
        // ceux d'avant l'écoute (box relancée), relus d'un coup.
        val depuis = serverNow()
        val listener = object : ChildEventListener {
            override fun onChildAdded(snapshot: DataSnapshot, previousChildName: String?) {
                val paquet = snapshot.value as? Map<*, *> ?: return
                Dessin.heureDeCle(snapshot.key)?.takeIf { it >= depuis }?.let { Reactivite.noter("dessin", serverNow() - it) }
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

    /**
     * La box hôte est en ligne : lu par les régies (liste des prestations, Régie PC) pour distinguer une fête en
     * cours d'une fête interrompue. À la coupure, le serveur écrit lui-même « hors ligne » avec l'heure. `uid` :
     * seule la parole de l'hôte actuel compte (après un changement de box, celle de l'ancienne est ignorée).
     */
    private fun announceHost(ref: DatabaseReference) {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        val host = ref.child("hostOnline")
        hostRef = ref
        host.onDisconnect().setValue(mapOf("online" to false, "at" to ServerValue.TIMESTAMP, "uid" to uid))
            .addOnFailureListener { Log.w(TAG, "Présence de la box (coupure)", it) }
        host.setValue(mapOf("online" to true, "at" to ServerValue.TIMESTAMP, "uid" to uid))
            .addOnFailureListener { Log.w(TAG, "Présence de la box", it) }
    }

    private fun stopListening() {
        offlineWatch?.cancel()
        offlineWatch = null
        // Partie quittée (nouvelle partie, partie confiée à une autre box) : le serveur n'écrira plus rien pour elle.
        hostRef?.child("hostOnline")?.onDisconnect()?.cancel()
        hostRef = null
        hostRecheck?.cancel()
        hostRecheck = null
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
        watchDuel(null)
        watchSimon(null)
        watchChrono(null)
        watchDrawing(null)
        commandsListener?.let { (r, l) -> r.removeEventListener(l) }
        commandsListener = null
        judging.clear()
    }

    override fun onCleared() {
        prechargeur.arreter()
        stopListening()
        boxWatch.forEach { (r, l) -> r.removeEventListener(l) }
        boxWatch.clear()
    }

    companion object {
        private const val TAG = "Partie"
        private var persistenceOn = false
        const val AUTO_RESUME_SECONDS = 15
        const val MAX_TEAMS = 8
        /** Longueur maximale d'un nom d'équipe (comme les règles Firebase). */
        const val MAX_TEAM_NAME = 20
        private const val ADMIT = "admit"
        private const val REPLACE = "replace"
        private const val NEW_GAME = "newgame"
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
        /** « Terminer la partie et quitter » : attente maximale de l'écriture de fin avant de fermer l'appli. */
        internal const val FIN_ET_QUITTER_MAX_MS = 3_000L
        private const val CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        /** Demande effacée sans autorisation au bout de ce délai : la Régie PC l'a refusée. */
        private const val BOX_REFUSAL_CHECK_MS = 2_000L
        /** Box de secours : attente de la partie confiée, telle que le serveur la connaît, avant une lecture ordinaire. */
        private const val HANDOFF_WAIT_MS = 15_000L
        /** Lecture sur le serveur de l'hôte d'une partie à reprendre, avant de se contenter de la copie locale. */
        private const val MOVED_CHECK_MS = 4_000L
        /** Présence de la box effacée par une autre écriture : nouvelle annonce au bout de ce délai. */
        private const val HOST_RECHECK_MS = 2_000L

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
            // Mimes en file (cedric, 26/10) : 1re image au lancement, « ⏭ Passer » (mime_skip), couleur suivante d'un geste.
            "mimesEnFile" to true,
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
            // Les coffres mystères : coffres ouverts depuis les tablettes, coffre au hasard en secours (commande chest_random).
            "coffres" to true,
            // Gonfleur fou : tapes des tablettes dans pumps/, fin de la course par la box.
            "gonfleur" to true,
            // « Ça va exploser ! » : envois des tablettes dans potatoPass/, mèche et explosion par la box, envoi au hasard (potato_random).
            "patate" to true,
            // « Ça va exploser ! » : « 🏁 Dernière bombe » / « ⏭ Jeu suivant » du téléphone (potato_stop), nombre de bombes réglé.
            "patateStop" to true,
            // Statues musicales : les chansons choisies (audioIds) jouées l'une après l'autre.
            "statuesChansons" to true,
            "disparu" to true,
            // Le Duel des robots : buzz des tablettes dans duel/, PAN et jugement par la box, duel_start / duel_next / duel_stop.
            "duel" to true,
            // Le Simon de Buzzy : réponses des tablettes dans simon/, suite secrète et jugement par la box, simon_go / simon_stop.
            "simon" to true,
            // Le Chrono de Buzzy : buzz des tablettes dans chrono/, 0 affiché et jugement par la box, chrono_go / chrono_cible / chrono_reveal / chrono_stop.
            "chrono" to true,
            // Mauvaise prestation : une autre prestation remplace celle-ci tant qu'aucun point n'a été donné (retour au salon).
            "programReset" to true,
            "questions" to quiz.questions.map {
                clean(mapOf(
                    "id" to it.id, "text" to it.text, "choices" to it.choices.ifEmpty { null }, "correct" to it.correct,
                    "duration" to it.durationSec, "kind" to it.kind.code, "double" to it.double, "round" to it.roundTitle,
                    "cards" to it.cards.ifEmpty { null }?.map { c -> clean(mapOf("word" to c.word, "image" to c.image, "imageId" to c.imageId)) },
                    "image" to it.emoji, "imageId" to it.imageId, "artist" to it.artist, "audioId" to it.audioId,
                    "refrainId" to it.refrainId, "lyrics" to it.lyrics, "audioIds" to it.audioIds.ifEmpty { null },
                    "choiceImages" to it.choiceImages.ifEmpty { null }?.map { id -> id ?: "" },
                    // Blind test : valeur et durée de révélation du morceau, relues telles quelles après un redémarrage.
                    "points" to it.points?.takeIf { _ -> it.isBlind }, "reveal" to it.revealSec.takeIf { _ -> it.isBlind },
                    // « Ça va exploser ! » : nombre de bombes réglé dans la Régie PC.
                    "bombs" to it.bombs.takeIf { _ -> it.isPatate },
                    // Mimes en file : la couleur de l'équipe seule de la manche, relue après un redémarrage.
                    "couleur" to it.couleur,
                    // Le Duel des robots : joueurs par équipe et durée du face-à-face, relus après un redémarrage.
                    "faceMin" to it.faceMin.takeIf { _ -> it.isDuel },
                    "faceMax" to it.faceMax.takeIf { _ -> it.isDuel }, "longs" to it.longs.takeIf { _ -> it.isDuel },
                    // Le Simon de Buzzy : tours, temps pour répondre et joueurs par équipe, relus après un redémarrage.
                    "tours" to (if (it.isSimon) it.simonTours else if (it.isChrono) it.chronoTours else null), "reponse" to it.simonSec.takeIf { _ -> it.isSimon },
                    "joueurs" to it.joueurs.takeIf { _ -> it.isDuel || it.isSimon },
                    // Le Chrono de Buzzy : la cible réglée dans la Régie PC, relue après un redémarrage.
                    "cible" to it.chronoCible.takeIf { _ -> it.isChrono },
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

/** Les coupures du téléphone de la régie, suivies avec celles des tablettes (voir [Coupures]). */
private const val REGIE_COUPURE = "regie:"
/** Statues : la régie copie les chansons entières (plusieurs Mo chacune) pendant la fête ; la box les attend longtemps. */
private const val SONG_WAIT_MS = 20 * 60_000L
/** Ménage du cache des médias : laissé à la partie qui s'ouvre le temps de démarrer et de lancer ses copies. */
private const val RANGEMENT_DELAI_MS = 15_000L

/**
 * Partie confiée par la régie au salon [lobby] : attend la version du serveur où cette box ([uid]) est l'hôte et
 * où le changement vise bien ce salon. Une copie locale plus ancienne (box d'origine qui retrouve sa partie) est
 * ignorée. Null au-delà de [timeoutMs] ; exception si la lecture est refusée (partie confiée ailleurs entre-temps).
 */
private suspend fun DatabaseReference.readHandedOver(lobby: String, uid: String, timeoutMs: Long): PartieLue? {
    // L'hôte et `takeover` changent dans la même écriture : on attend l'hôte (lisible de tous), puis on relit la partie,
    // sans ses médias (voir [CLES_REPRISE]).
    val hote = child("hostUid")
    withTimeoutOrNull(timeoutMs) {
        suspendCancellableCoroutine<Unit> { cont ->
            val listener = object : ValueEventListener {
                override fun onDataChange(snapshot: DataSnapshot) {
                    if (snapshot.getValue(String::class.java) == uid && cont.isActive) { hote.removeEventListener(this); cont.resume(Unit) }
                }

                override fun onCancelled(error: DatabaseError) {
                    if (cont.isActive) cont.resumeWithException(error.toException())
                }
            }
            hote.addValueEventListener(listener)
            cont.invokeOnCancellation { hote.removeEventListener(listener) }
        }
    } ?: return null
    return lirePartie()?.takeIf { it.child("takeover/to").getValue(String::class.java) == lobby }
}

/** Ce que la box fait au démarrage de la partie qu'elle avait mémorisée (voir [decisionReprise]). */
internal sealed interface Reprise {
    /** Une prestation commencée, de moins de 24 h : l'écran « Reprendre » (reprise d'elle-même au bout du décompte). */
    data class Proposer(val offre: UiState.ResumeOffer) : Reprise
    /** Un salon pas encore commencé, de moins de 24 h : la box y revient seule, sans rien proposer. */
    data object Rouvrir : Reprise
    /** La régie a confié la partie à une autre box. */
    data object Deplacee : Reprise
    /** Pas d'Internet ni de copie sur la box : rien n'est décidé à l'aveugle. */
    data object SansReseau : Reprise
    /** Partie finie, vieille de plus de 24 h ou illisible : oubliée, une nouvelle partie est créée. */
    data object Rien : Reprise
}

/** Au-delà, une partie mémorisée n'est plus jamais reprise : c'était une autre fête (décision du 30/10). */
internal const val REPRISE_MAX_MS = 24L * 60 * 60 * 1000

/**
 * Décision de reprise d'après la phase de la partie mémorisée et l'heure où sa box a été vue pour la dernière fois
 * ([vueA], heure du serveur ; null si inconnue) : finie ou vieille de plus de 24 h, oubliée ; salon pas commencé,
 * rouvert sans question ; prestation commencée, proposée (le [Reprise.Proposer] rendu ici n'est qu'un marqueur).
 */
internal fun decisionReprise(phase: String?, vueA: Long?, maintenant: Long): Reprise = when {
    phase == null || phase == Phase.ENDED.code -> Reprise.Rien
    vueA != null && maintenant - vueA > REPRISE_MAX_MS -> Reprise.Rien
    phase == Phase.LOBBY.code -> Reprise.Rouvrir
    else -> Reprise.Proposer(UiState.ResumeOffer("", emptyList(), 0))
}

/** Écran d'erreur d'une box démarrée sans Internet, avant de savoir s'il faut reprendre la partie d'avant. */
internal const val SANS_RESEAU_AU_DEMARRAGE =
    "La box n'a pas Internet. Vérifiez le Wi-Fi, puis Réessayer : la partie d'avant sera proposée seulement si elle était commencée."

/**
 * Ce qu'une reprise relit d'une partie : tout sauf ses médias. Les chansons et photos que la régie copie dans la partie
 * (`sounds`, `images`, `choiceImages` : des dizaines de Mo) empêchaient toute reprise (25/10 au soir : « La base
 * Firebase ne répond pas » après un arrêt de l'appli, « Réessayer » sans effet). Ils arrivent ensuite, un par un.
 */
internal val CLES_REPRISE = listOf(
    "hostUid", "quizId", "conducteur", "show", "showStatus", "public", "log", "state", "teams",
    "commands", "commandStatus", "takeover", "regie", "pairingLock",
    // Quand la partie a été vue pour la dernière fois (proposition de reprise : jamais une partie de plus de 24 h).
    "createdAt", "hostOnline",
)

/** Une partie relue par morceaux ([CLES_REPRISE]) : se lit comme la partie entière. */
internal class PartieLue(private val morceau: (String) -> DataSnapshot) {
    /** Comme [DataSnapshot.child] sur la partie entière : « showStatus/id », « teams »… */
    fun child(chemin: String): DataSnapshot {
        val reste = chemin.substringAfter('/', "")
        return morceau(chemin.substringBefore('/')).let { if (reste.isEmpty()) it else it.child(reste) }
    }
}

/**
 * Les morceaux [cles] de la partie, lus en même temps (chacun avec un long délai) ; le serveur muet : on réessaie,
 * [essais] fois en tout, avant de renoncer (null). Une lecture refusée (partie confiée à une autre box) remonte.
 */
private suspend fun DatabaseReference.lirePartie(cles: List<String> = CLES_REPRISE, essais: Int = 3): PartieLue? {
    for (essai in 1..essais) {
        val lus = coroutineScope { cles.map { k -> async { k to child(k).readOnce(LECTURE_REPRISE_MS) } }.awaitAll() }
        if (lus.all { it.second != null }) {
            val morceaux = lus.associate { (k, v) -> k to v!! }
            return PartieLue { morceaux.getValue(it) }
        }
        Log.w("QuizTv", "Partie $key : serveur muet à la lecture $essai/$essais")
        if (essai < essais) delay(2_000L * essai)
    }
    return null
}

/** Délai de chaque morceau d'une partie relue à la reprise (Wi-Fi d'une salle des fêtes, box qui vient de démarrer). */
private const val LECTURE_REPRISE_MS = 15_000L

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

