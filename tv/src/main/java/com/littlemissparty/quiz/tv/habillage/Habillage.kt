package com.littlemissparty.quiz.tv.habillage

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.littlemissparty.quiz.engine.SIMON_AVEC_CHIFFRES
import com.littlemissparty.quiz.engine.SIMON_CHIFFRES_DES
import com.littlemissparty.quiz.engine.Phase
import com.littlemissparty.quiz.engine.Question
import com.littlemissparty.quiz.engine.QuestionKind
import com.littlemissparty.quiz.tv.UiState
import com.littlemissparty.quiz.tv.annonceStatues
import com.littlemissparty.quiz.tv.etapeDisparu
import kotlinx.coroutines.delay

/**
 * Couleurs du plateau « Néon chic » (démo validée le 18 octobre). Design « The Game Show » : chaque couleur prend son
 * équivalent du kit (l'or devient le cyan des néons), sans toucher aux écrans qui les utilisent.
 */
object Neon {
    val Nuit: Color get() = selonLook(Color(0xFF0B0614), GS.Noir)
    val Nuit2: Color get() = selonLook(Color(0xFF1A0B2E), GS.Nuit)
    /** Fond des cadres et ovales sombres qui portent un texte (Game Show : « Doux 2 », [GS.Plaque]). */
    val Plaque: Color get() = selonLook(Color(0xE61A0B2E), GS.Plaque)
    /** Texte clair posé sur [Plaque] (Game Show : blanc cassé, [GS.PlaqueTexte]). */
    val PlaqueTexte: Color get() = selonLook(Color(0xFFFFF4F2), GS.PlaqueTexte)
    /** Fonds de l'appli (plateau, intermèdes, fenêtres) : le violet un peu plus clair validé sur l'écran du blind test. */
    val FondHaut: Color get() = selonLook(Color(0xFF3A1466), GS.VioletProfond)
    val Fond: Color get() = selonLook(Color(0xFF221040), GS.Nuit)
    val FondBas: Color get() = selonLook(Color(0xFF160B2B), GS.Noir)
    val Violet: Color get() = selonLook(Color(0xFF6E28BE), GS.Violet)
    val Blanc: Color get() = selonLook(Color(0xFFFFF4F2), GS.Encre)
    val Halo: Color get() = selonLook(Color(0xFFF888B3), GS.Rose)
    val Or: Color get() = selonLook(Color(0xFFF0CC92), GS.Cyan)
    val OrClair: Color get() = selonLook(Color(0xFFF6DAAA), GS.CyanClair)
    val OrProfond: Color get() = selonLook(Color(0xFFE0B577), GS.CyanProfond)
    val Chaud: Color get() = selonLook(Color(0xFFFF5A1F), GS.Orange)
    /** Révélation (palette A, audit du 19 octobre) : vert électrique = juste, corail = faux. Le jaune pâle ne sert plus de « bonne réponse ». */
    val JusteClair: Color get() = selonLook(Color(0xFF2EE86B), GS.Juste)
    val JusteProfond: Color get() = selonLook(Color(0xFF12C957), GS.JusteProfond)
    val JusteTexte: Color get() = selonLook(Color(0xFF08240F), GS.JusteTexte)
    val Faux: Color get() = selonLook(Color(0xFFFF5A5F), GS.Faux)
}

/** Ce qui doit survivre à l'écran : un générique par partie, même si la box se reconnecte. */
object Habillage {
    val directeur = DirecteurSonore()
    val generiquesVus = mutableSetOf<String>()
    /** Dernier jeu montré par partie : le rideau de transition ne passe qu'au changement de jeu. */
    val epreuvesVues = mutableMapOf<String, String>()
    /** Tours de mimes déjà présentés par le bandeau d'équipe. */
    val equipesAnnoncees = mutableSetOf<String>()
    /** Parties dont la box a montré l'accueil : la grande intro du Game Show attend que Sarah lance la fête. */
    val introsAttendues = mutableSetOf<String>()

    /**
     * La fête vient d'être lancée et la grande intro va passer : vrai dès la toute première image de la présentation du
     * premier jeu, avant même que l'intro ne démarre. Le rideau « C'EST PARTI ! » et son jingle n'ont pas le temps de
     * passer devant (cedric, 25/10 : « Lancer la fête » coupe directement sur le réveil du robot, sans transition).
     */
    fun lancementEnVue(s: UiState.Playing): Boolean =
        lancementEnVue(Look.gs, s.phase, s.intro, s.paused, s.code in introsAttendues)
    /** La grande intro du lancement passe à l'écran (avec son propre son) : la bande-son se tait, le robot aussi. */
    val introLancement = mutableStateOf(false)
    /** L'intro vidéo d'un jeu passe sur l'écran de présentation : le décor ne lit pas son propre fond vidéo. */
    val introJeu = mutableStateOf(false)

    /** La présentation du blind test a dessiné l'ancienne platine (Classique, ou platine néon introuvable) ; lu par les tests. */
    @Volatile var platineIntroClassique = false

    /** La vidéo de l'écran de fin du Game Show passe : le décor ne lit pas son propre fond vidéo. */
    val finVideo = mutableStateOf(false)

    /** Le podium du Game Show est à l'écran : rien ne passe par-dessus (le BONUS d'une dernière correction de score). */
    val podium = mutableStateOf(false)

    /** Le Duel des robots du Game Show passe ses plans vidéo : le décor ne lit pas son propre fond vidéo. */
    val videoDuel = mutableStateOf(false)
}

/**
 * Habillage de toute l'appli TV : le décor du plateau et la bande-son, qui suivent la partie sans jamais
 * la modifier. Se place à la place de l'ancien fond, sous les écrans.
 */
@Composable
fun HabillageTv(state: UiState) {
    val context = LocalContext.current
    LaunchedEffect(Unit) { Sons.preparer(context) }
    val cycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(cycle) {
        val observateur = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_STOP -> Sons.suspendre()
                Lifecycle.Event.ON_START -> {
                    com.littlemissparty.quiz.tv.Fluidite.oublierDerniere()
                    Sons.reprendre()
                }
                else -> {}
            }
        }
        cycle.addObserver(observateur)
        onDispose { cycle.removeObserver(observateur) }
    }
    val urgent = chronoUrgent(state as? UiState.Playing)
    val decompte = secondesRestantes(state as? UiState.Playing)
    val indices = indicesQuiSuis(state as? UiState.Playing)
    val statue = statueFigee(state as? UiState.Playing)
    // Statues : annonce des gagnantes (1 roulement de tambour, 2 gagnantes, 3 récap), 0 hors annonce.
    val annonce = (state as? UiState.Playing)?.let { s -> annonceStatues(s.statues?.result?.at?.takeIf { s.question?.isStatues == true }, s.serverOffset) } ?: 0
    // Qui a disparu ? : l'étape affichée par le plateau (mémoriser, tour de magie, chercher, réponse), de 1 à 4.
    val disparu = (state as? UiState.Playing)?.let { s -> s.question?.takeIf { it.isDisparu }?.let { etapeDisparu(it, s).ordinal + 1 } } ?: 0
    val lancement = Habillage.introLancement.value || (state as? UiState.Playing)?.let(Habillage::lancementEnVue) == true
    val instant = remember(state, urgent, indices, statue, disparu, decompte, lancement, annonce) { instantDe(state, urgent, System.currentTimeMillis(), indices, statue, disparu, decompte, presentation = (state as? UiState.Playing)?.intro == true, lancement = lancement, annonceStatues = annonce) }
    LaunchedEffect(instant) { Sons.executer(Habillage.directeur.observer(instant)) }
    // Mesure de la fluidité : l'écran en cours, pour savoir où la box accroche (rapports de la box).
    SideEffect { com.littlemissparty.quiz.tv.Fluidite.ecran = etiquetteFluidite(state) }
    // Dernières questions du quiz à points multipliés : le plateau passe au doré, de la question à sa révélation.
    val dore = (state as? UiState.Playing)?.let { it.question?.double == true && it.phase in listOf(Phase.QUESTION, Phase.CLOSED, Phase.REVEAL) } == true
    // Accueil du Game Show : le robot qui dort, sous Get Lucky ; pendant la grande intro, aucune autre vidéo.
    val salon = (state as? UiState.Playing)?.phase == Phase.LOBBY
    val introJeu = Habillage.introJeu.value ||
        (state as? UiState.Playing)?.let { s -> introJeuEnVue(Look.gs, s.phase, s.intro, s.paused, familleJeu(s.question)) } == true
    DecorPlateau(chaud = urgent, dore = dore, accueil = salon, sansVideo = lancement || introJeu || Habillage.finVideo.value || Habillage.videoDuel.value)
}

/** « question zoom », « presentation gonfleur », « scores », « accueil »… : l'écran, tel que le compte la fluidité. */
internal fun etiquetteFluidite(state: UiState): String {
    val s = state as? UiState.Playing ?: return state::class.simpleName.orEmpty().lowercase()
    if (s.phase == Phase.LOBBY) return "accueil"
    if (Habillage.introLancement.value) return "intro lancement"
    val jeu = s.question?.let { " " + familleJeu(it) }.orEmpty()
    return when {
        s.paused -> "pause"
        s.intro && s.phase == Phase.QUESTION -> "presentation$jeu"
        s.phase == Phase.SCORES || s.phase == Phase.ENDED -> s.phase.code
        else -> s.phase.code + jeu
    }
}

/** Voir [Habillage.lancementEnVue] : la présentation du premier jeu, lancée depuis l'accueil de cette box, en Game Show. */
internal fun lancementEnVue(gameShow: Boolean, phase: Phase, presentation: Boolean, enPause: Boolean, introAttendue: Boolean) =
    gameShow && introAttendue && phase == Phase.QUESTION && presentation && !enPause

/**
 * L'écran de présentation va montrer l'intro vidéo de son jeu ([IntroJeuGameShow]) : dès la même image, le décor ne
 * relance pas son propre fond (test du 28/10 au soir : entre la fin de l'éveil du robot et l'intro du Quiz, l'image
 * fixe du plateau passait une image, puis du noir, avant l'intro). Le passage reste noir jusqu'au fondu de l'intro.
 */
internal fun introJeuEnVue(gameShow: Boolean, phase: Phase, presentation: Boolean, enPause: Boolean, famille: String) =
    gameShow && phase == Phase.QUESTION && presentation && !enPause && nomIntroJeu(famille) != null

/**
 * [presentation] : la TV montre l'écran de présentation du jeu (avant sa première question, en attendant que
 * Sarah le lance) ; musique douce, ni jingle de question ni bulles. [lancement] : la grande intro du Game Show passe
 * par-dessus, avec sa propre musique.
 */
internal fun instantDe(state: UiState, urgent: Boolean, maintenant: Long, indices: Int = 0, statue: Boolean = false, disparu: Int = 0, decompte: Int = 0, presentation: Boolean = false, lancement: Boolean = false, annonceStatues: Int = 0): Instant {
    val s = state as? UiState.Playing ?: return Instant(Ecran.HORS_PARTIE)
    val blind = s.blind?.takeIf { s.question?.isBlind == true }
    val ecran = when (s.phase) {
        Phase.LOBBY -> Ecran.SALON
        Phase.QUESTION -> when {
            presentation -> Ecran.PRESENTATION
            s.mime == null -> Ecran.QUESTION
            s.mime.team != null -> Ecran.MIMES_TOUR
            else -> Ecran.MIMES
        }
        Phase.CLOSED -> Ecran.VERROUILLEE
        Phase.REVEAL -> Ecran.REVELATION
        Phase.SCORES -> Ecran.CLASSEMENT
        Phase.ENDED -> Ecran.FIN
    }
    return Instant(
        ecran = ecran,
        partie = s.code,
        index = s.index,
        equipes = s.teams.size,
        reponses = s.answered.size,
        propositions = s.question?.choices?.size ?: 4,
        enPause = s.paused,
        repriseDansMs = s.resumeAt?.let { it - (maintenant + s.serverOffset) }?.coerceAtLeast(0) ?: 0,
        urgent = urgent,
        decompte = decompte,
        buzzeur = s.teams.indexOfFirst { it.uid == s.lastFunBuzz },
        buzzs = s.funTotal,
        premiere = s.index == 0,
        superFinale = s.question?.double == true,
        annonceFacteur = s.question?.double == true && s.introUntil != null,
        gagnants = if (s.phase == Phase.REVEAL) s.awards.values.count { it.points > 0 } else 0,
        meneurAPoints = (s.ranking.firstOrNull()?.second ?: 0) > 0,
        trouves = s.mime?.takeIf { it.team != null }?.found ?: 0,
        passes = s.mime?.takeIf { it.team != null }?.passed ?: 0,
        onTourne = s.mime?.takeIf { it.team != null }?.relais != null,
        pictionary = s.mime?.picto == true,
        pictioTrouve = (s.mime?.last?.found ?: 0) > 0,
        express = s.question?.isExpress == true,
        reponseVraie = s.question?.let { q -> q.choices.getOrNull(q.correct)?.trim()?.startsWith("vrai", ignoreCase = true) } == true,
        zoom = s.question?.isZoom == true,
        chronoMs = s.question?.durationMs ?: 0,
        jeuBuzz = s.question?.isBuzz == true,
        flou = s.question?.isFlou == true,
        chante = s.question?.isChante == true,
        quiSuis = s.question?.isQuiSuis == true,
        buzzEquipe = s.teams.indexOfFirst { it.uid == s.buzzTeam },
        ratees = s.buzzBlocked.size,
        indices = indices,
        // Blind test, quiz musical (extrait bien reçu), statues : la TV joue déjà une musique, l'habillage se tait.
        musical = s.question?.let { q -> q.isStatues || (q.isBlind && s.blind != null) || q.audioId?.let { s.sounds[it] } != null } == true,
        quizMusical = s.question?.let { q -> q.isMusical && q.audioId?.let { s.sounds[it] } != null } == true,
        statue = statue && s.question?.isStatues == true,
        statuesAnnonce = if (s.question?.isStatues == true) annonceStatues else 0,
        statuesGagnantes = s.statues?.result?.winners?.isNotEmpty() == true,
        patate = s.question?.isPatate == true,
        duel = s.question?.isDuel == true,
        duelEtape = if (s.question?.isDuel == true) s.duel?.step.orEmpty() else "",
        chronoEtape = if (s.question?.isChrono == true) s.chrono?.step.orEmpty() else "",
        simon = s.question?.isSimon == true,
        simonSuite = s.question?.isSimon == true && s.simon?.enCours == true,
        simonChiffres = SIMON_AVEC_CHIFFRES && s.question?.isSimon == true && s.simon?.enCours == true && (s.simon?.suite ?: 0) >= SIMON_CHIFFRES_DES,
        tempsEcoule = s.phase == Phase.CLOSED && s.tempsEcoule,
        disparu = if (s.question?.isDisparu == true) disparu else 0,
        // Blind test : présentation du 1er morceau, chanson qui joue, points doublés, révélation raccourcie, bilan.
        blind = blind != null,
        blindPresentation = blind != null && s.phase == Phase.QUESTION && blind.numero == 1 && !blind.played && blind.waiting && s.buzzTeam == null,
        blindAttente = blind != null && s.phase == Phase.QUESTION && !blind.played && blind.waiting && s.buzzTeam == null,
        blindLecture = blind != null && s.phase == Phase.QUESTION && !blind.waiting && s.buzzTeam == null,
        blindDouble = blind?.doubled == true,
        blindCoupe = blind?.cut == true,
        blindBilan = blind != null && s.phase == Phase.SCORES && blind.numero >= blind.total,
        nombre = s.question?.isNumber == true,
        pile = s.phase == Phase.REVEAL && s.question?.isNumber == true && s.awards.values.any { it.choice == s.question?.correct },
        epreuve = s.question?.takeIf { s.phase == Phase.QUESTION || s.phase == Phase.CLOSED || s.phase == Phase.REVEAL }?.let(::epreuveDe) ?: "",
        gameShow = Look.gs,
        outro = Look.gs && Outro.disponible,
        finLancee = s.phase == Phase.ENDED && s.outroAt != null,
        lancement = lancement,
        famille = familleJeu(s.question),
    )
}

/**
 * Le jeu auquel appartient une question : les mimes, ou une manche. Une manche nommée reste un seul jeu même
 * si elle mélange des types de questions (quiz et Juste Chiffre) : le rideau ne passe qu'à son début.
 */
internal fun epreuveDe(q: Question): String {
    val titre = q.roundTitle?.takeIf { it.isNotBlank() }
    if (q.kind == QuestionKind.MIME) return "mimes|" + (titre ?: "")
    if (titre != null) return "manche|$titre"
    return when (q.kind) {
        QuestionKind.NUMBER -> "chiffre"
        QuestionKind.EXPRESS -> "express"
        QuestionKind.ZOOM -> "zoom"
        QuestionKind.FLOU -> "flou"
        QuestionKind.CHANTE -> "chante"
        QuestionKind.QUISUIS -> "quisuis"
        QuestionKind.BLIND -> "blind"
        QuestionKind.STATUES -> "statues"
        QuestionKind.DISPARU -> "disparu"
        else -> "quiz"
    } + "|"
}

/** Qui suis-je ? : nombre d'indices affichés, calculé comme le plateau (chrono à l'heure du serveur). */
@Composable
private fun indicesQuiSuis(s: UiState.Playing?): Int {
    var n by remember { mutableIntStateOf(0) }
    val q = s?.question?.takeIf { it.isQuiSuis }
    // Chrono arrêté (pause, buzz en attente du verdict) : on ne compte plus, le nombre d'indices reste.
    val deadline = if (s != null && q != null && s.phase == Phase.QUESTION && !s.paused) s.deadline else null
    val depart = s?.resumeAt ?: 0L
    val decalage = s?.serverOffset ?: 0L
    LaunchedEffect(q?.id, deadline, depart) {
        if (q == null) n = 0
        if (q == null || deadline == null) return@LaunchedEffect
        while (true) {
            val reste = (deadline - maxOf(System.currentTimeMillis() + decalage, depart)).coerceAtLeast(0)
            n = q.cluesShown(q.durationMs - reste)
            if (reste == 0L) break
            delay(200)
        }
    }
    return n
}

/**
 * Statues musicales : vrai pendant une statue (Sarah a coupé la musique, ou la chanson est finie), faux quand on danse
 * et pendant l'annonce des gagnantes. En pause, la valeur reste, pour ne pas sonner « on repart » quand l'animatrice
 * met en pause.
 */
@Composable
private fun statueFigee(s: UiState.Playing?): Boolean {
    var figee by remember { mutableStateOf(false) }
    val st = s?.statues?.takeIf { s.phase == Phase.QUESTION && s.question?.isStatues == true }
    if (st == null) figee = false
    else if (s?.paused != true) figee = !st.dancing && st.result == null
    return figee
}

/**
 * Vrai pendant la fin du chrono (5 dernières secondes d'une question, 10 d'un tour de mimes), calculé comme
 * le chrono affiché (heure du serveur).
 */
@Composable
private fun chronoUrgent(s: UiState.Playing?): Boolean {
    var urgent by remember { mutableStateOf(false) }
    val deadline = if (s != null && s.phase == Phase.QUESTION && !s.paused) s.deadline else null
    val fenetre = if (s?.mime != null) 10_000L else 5_000L
    LaunchedEffect(deadline, s?.resumeAt, fenetre) {
        if (s == null || deadline == null) {
            urgent = false
            return@LaunchedEffect
        }
        val depart = s.resumeAt ?: 0L
        while (true) {
            val maintenant = System.currentTimeMillis() + s.serverOffset
            val reste = deadline - maxOf(maintenant, depart)
            // Pas pendant le décompte 3, 2, 1 d'une reprise : la tension attend que le chrono reparte. Elle tient
            // jusqu'au changement d'écran (la box ferme la question un peu après zéro), sans retomber à zéro.
            urgent = maintenant >= depart && reste <= fenetre
            if (reste <= 0) break
            delay(100)
        }
    }
    return urgent
}

/**
 * Secondes restantes (5 à 1) pendant les cinq dernières secondes du chrono affiché, 0 sinon : ne change qu'une fois
 * par seconde. 0 pendant une pause, un buzz (chrono figé) et le décompte 3, 2, 1 d'une reprise.
 */
@Composable
internal fun secondesRestantes(s: UiState.Playing?): Int {
    var secondes by remember { mutableStateOf(0) }
    val deadline = if (s != null && (s.phase == Phase.QUESTION) && !s.paused) s.deadline else null
    LaunchedEffect(deadline, s?.resumeAt) {
        if (s == null || deadline == null) {
            secondes = 0
            return@LaunchedEffect
        }
        val depart = s.resumeAt ?: 0L
        while (true) {
            val maintenant = System.currentTimeMillis() + s.serverOffset
            val reste = deadline - maxOf(maintenant, depart)
            secondes = if (maintenant >= depart && reste in 1..5_000) ((reste + 999) / 1_000).toInt() else 0
            if (reste <= 0) break
            delay(if (reste > 6_000) 500 else 50)
        }
    }
    return secondes
}
