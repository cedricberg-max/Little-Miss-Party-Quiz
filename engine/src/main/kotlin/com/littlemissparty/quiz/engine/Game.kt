package com.littlemissparty.quiz.engine

enum class Phase(val code: String) {
    LOBBY("lobby"),
    QUESTION("question"),
    CLOSED("closed"),
    REVEAL("reveal"),
    SCORES("scores"),
    ENDED("ended"),
}

/** Période pendant laquelle le chrono tourne ([end] nul tant qu'il tourne encore). */
data class Segment(val start: Long, val end: Long? = null)

/** Pause en cours : qui l'a provoquée et depuis quand. */
data class Hold(val reason: String, val team: String?, val since: Long)

/** État de la partie, entièrement déduit du journal. */
data class GameState(
    val phase: Phase = Phase.LOBBY,
    val index: Int = -1,
    val qid: String? = null,
    val segments: List<Segment> = emptyList(),
    val awards: Map<String, Map<String, Award>> = emptyMap(),
    val adjustments: Map<Int, ScoreAdjusted> = emptyMap(),
    val lastSeq: Int = 0,
    val hold: Hold? = null,
    /** Heure du serveur où se termine le décompte de la dernière reprise. */
    val resumeAt: Long? = null,
) {
    val paused: Boolean get() = hold != null

    /** Temps de chrono écoulé à l'instant [t] (pauses exclues). */
    fun elapsedAt(t: Long): Long = segments.sumOf { s ->
        val end = minOf(s.end ?: Long.MAX_VALUE, t)
        (end - s.start).coerceAtLeast(0)
    }

    /** Total de chaque équipe : points des questions + corrections. Recalculé à chaque fois, jamais cumulé. */
    fun scores(): Map<String, Int> {
        val totals = mutableMapOf<String, Int>()
        awards.values.forEach { perTeam -> perTeam.forEach { (team, a) -> totals.merge(team, a.points, Int::plus) } }
        adjustments.values.forEach { totals.merge(it.team, it.delta, Int::plus) }
        return totals
    }
}

/**
 * La partie vue par la box, seule arbitre des points.
 * Chaque méthode d'action renvoie l'événement à enregistrer, ou null si l'action
 * n'a pas de sens dans l'état courant (double clic, commande en retard…) : rien n'est alors modifié.
 */
class Game(val quiz: Quiz, history: List<GameEvent> = emptyList()) {

    private val log = mutableListOf<GameEvent>()
    var state = GameState()
        private set

    val events: List<GameEvent> get() = log

    init {
        history.sortedBy { it.seq }.forEach { record(it) }
    }

    val question: Question? get() = state.index.takeIf { it >= 0 }?.let { quiz.questions.getOrNull(it) }
    val isLastQuestion: Boolean get() = state.index >= quiz.questions.lastIndex

    /** Millisecondes restantes au chrono à l'instant [now]. */
    fun remainingMs(now: Long): Long {
        val q = question ?: return 0
        if (state.phase != Phase.QUESTION) return 0
        return (q.durationMs - state.elapsedAt(now)).coerceAtLeast(0)
    }

    /** Heure du serveur à laquelle le chrono atteindra zéro, ou null s'il est en pause ou arrêté. */
    fun deadline(): Long? {
        val q = question ?: return null
        if (state.phase != Phase.QUESTION || state.paused) return null
        val running = state.segments.last()
        val before = state.elapsedAt(running.start)
        return running.start + q.durationMs - before
    }

    /**
     * Ajoute un événement au journal s'il est valide. Un événement déjà vu (même numéro)
     * ou impossible dans l'état courant est ignoré : rejouer deux fois le journal ne change rien.
     */
    fun record(event: GameEvent): Boolean {
        if (event.seq <= state.lastSeq) return false
        val next = reduce(state, event) ?: return false
        state = next.copy(lastSeq = event.seq)
        log += event
        return true
    }

    private fun reduce(s: GameState, e: GameEvent): GameState? = when (e) {
        is QuestionOpened -> {
            val q = quiz.questions.getOrNull(e.index)
            val canOpen = s.phase == Phase.LOBBY || s.phase == Phase.SCORES || s.phase == Phase.REVEAL
            if (q == null || q.id != e.qid || !canOpen || e.index <= s.index || s.paused) null
            else s.copy(phase = Phase.QUESTION, index = e.index, qid = e.qid, segments = listOf(Segment(e.at)), resumeAt = null)
        }
        is Paused ->
            if (s.phase == Phase.LOBBY || s.phase == Phase.ENDED || s.paused) null
            else s.copy(
                hold = Hold(e.reason, e.team, e.at),
                segments = if (s.phase == Phase.QUESTION) {
                    // Un chrono encore dans son décompte de reprise n'a pas commencé : rien n'est décompté.
                    s.segments.dropLast(1) + s.segments.last().let { it.copy(end = maxOf(e.at, it.start)) }
                } else s.segments,
            )
        is Resumed ->
            if (!s.paused) null
            else {
                val start = e.at + e.countdownMs.coerceIn(0, 10_000)
                s.copy(
                    hold = null,
                    resumeAt = start,
                    segments = if (s.phase == Phase.QUESTION) s.segments + Segment(start) else s.segments,
                )
            }
        // Accepté en pause pour rejouer les journaux d'avant la pause générale (la fermeture levait la pause) ;
        // les actions de la box et de la régie, elles, ne ferment jamais une question en pause.
        is QuestionClosed ->
            if (s.phase != Phase.QUESTION) null
            else s.copy(
                phase = Phase.CLOSED,
                hold = null,
                segments = s.segments.map { if (it.end == null) it.copy(end = e.at) else it },
            )
        is Revealed ->
            if (s.phase != Phase.CLOSED || e.qid != s.qid || s.paused) null
            // Une seule attribution par question : la clé est l'identifiant de la question.
            else s.copy(phase = Phase.REVEAL, awards = s.awards + (e.qid to e.awards))
        is ScoresShown ->
            if (s.phase != Phase.REVEAL || s.paused) null else s.copy(phase = Phase.SCORES)
        is ScoreAdjusted ->
            if (e.delta == 0 || e.team.isBlank()) null
            else s.copy(adjustments = s.adjustments + (e.seq to e))
        is Undone ->
            if (e.target !in s.adjustments) null
            else s.copy(adjustments = s.adjustments - e.target)
        is GameEnded ->
            if (s.phase == Phase.ENDED) null else s.copy(phase = Phase.ENDED, hold = null)
    }

    private val nextSeq get() = state.lastSeq + 1

    private fun <E : GameEvent> emit(event: E): E? = event.takeIf { record(it) }

    /**
     * Le bouton « suivant » de l'animatrice : fait avancer la partie d'une étape.
     * [answers] sert seulement à l'étape de révélation.
     */
    fun next(now: Long, answers: Map<String, Answer> = emptyMap()): GameEvent? = if (state.paused) null else when (state.phase) {
        Phase.LOBBY -> openQuestion(0, now)
        Phase.QUESTION -> close(now)
        Phase.CLOSED -> reveal(now, answers)
        Phase.REVEAL -> emit(ScoresShown(nextSeq, now))
        Phase.SCORES -> if (isLastQuestion) end(now) else openQuestion(state.index + 1, now)
        Phase.ENDED -> null
    }

    fun openQuestion(index: Int, now: Long): GameEvent? {
        val q = quiz.questions.getOrNull(index) ?: return null
        return emit(QuestionOpened(nextSeq, now, index, q.id))
    }

    fun pause(now: Long, reason: String = PAUSE_REGIE, team: String? = null): GameEvent? =
        emit(Paused(nextSeq, now, reason, team))

    /** Reprise avec le décompte 3, 2, 1 : le chrono repart quand il se termine. */
    fun resume(now: Long, countdownMs: Long = RESUME_COUNTDOWN_MS): GameEvent? = emit(Resumed(nextSeq, now, countdownMs))
    fun close(now: Long): GameEvent? = if (state.paused) null else emit(QuestionClosed(nextSeq, now))

    /** Calcule les points à partir des réponses reçues. Les réponses des équipes inconnues sont ignorées par l'appelant. */
    fun reveal(now: Long, answers: Map<String, Answer>): GameEvent? {
        val q = question ?: return null
        if (state.phase != Phase.CLOSED) return null
        val awards = answers.mapValues { (_, a) ->
            val remaining = (q.durationMs - state.elapsedAt(a.at)).coerceAtLeast(0)
            Scoring.award(q, a, remaining.toDouble() / q.durationMs)
        }
        return emit(Revealed(nextSeq, now, q.id, awards))
    }

    fun adjust(team: String, delta: Int, reason: String, now: Long): GameEvent? =
        emit(ScoreAdjusted(nextSeq, now, team, delta, reason))

    fun undo(target: Int, now: Long): GameEvent? = emit(Undone(nextSeq, now, target))

    fun end(now: Long): GameEvent? = emit(GameEnded(nextSeq, now))
}
