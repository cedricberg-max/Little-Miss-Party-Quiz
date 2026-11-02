package com.littlemissparty.quiz.tv

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Density
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.em
import com.littlemissparty.quiz.tv.habillage.AvecPoliceLmp
import com.littlemissparty.quiz.tv.habillage.BonusMalus
import com.littlemissparty.quiz.tv.habillage.Design
import com.littlemissparty.quiz.tv.habillage.Habillage
import com.littlemissparty.quiz.tv.habillage.Look
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue

class MainActivity : ComponentActivity() {

    private val viewModel: GameViewModel by viewModels()
    private val updates: UpdateViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        CrashReporter.install(applicationContext)
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        Fluidite.demarrer()
        // Design choisi dans le menu Retour (The Game Show sur le plateau 3D par défaut, Classique en secours), gardé sur la box.
        val reglages = getSharedPreferences(PREFS_DESIGN, MODE_PRIVATE)
        Look.design = Design.depuis(reglages.getString(CLE_DESIGN, null))
        // Plateau 3D en fond seulement si la box sait lire deux vidéos à la fois (le fond et le robot par-dessus).
        Look.deuxVideos = com.littlemissparty.quiz.tv.habillage.videosSimultanees() >= 2
        // Grandes images du décor décodées d'avance, en fond : aucun écran ne les attend (test du 27/10 au soir).
        com.littlemissparty.quiz.tv.habillage.ImagesAppli.prechauffer(this)
        setContent {
            val state by viewModel.state.collectAsState()
            val updateUi by updates.ui.collectAsState()
            val updateOpen by updates.open.collectAsState()
            val updateAvailable by updates.available.collectAsState()
            val updateOffer by updates.offer.collectAsState()
            val reglagesManquants by updates.reglages.collectAsState()
            val coup by viewModel.coup.collectAsState()
            val vidage by viewModel.vidage.collectAsState()
            val busy = gameInProgress(state)
            LaunchedEffect(busy) { updates.setBusy(busy) }
            // Police Baloo 2 « cartes néon » (choix de cedric) pour tous les textes qui n'en imposent pas une autre.
            PoliceDesEcrans {
            Box(Modifier.fillMaxSize()) {
            // Pictionary : le dessin en direct passe à part, pour ne redessiner que la feuille à chaque trait.
            CompositionLocalProvider(LocalDessin provides viewModel.dessin) {
            QuizTvApp(
                state = state,
                actions = TvActions(
                    next = viewModel::next,
                    togglePause = viewModel::togglePause,
                    pause = viewModel::pause,
                    unpause = viewModel::unpause,
                    retry = viewModel::retry,
                    resume = viewModel::resume,
                    newGame = viewModel::newGame,
                    // La partie active reste mémorisée : elle sera proposée au prochain lancement.
                    quit = ::finish,
                    terminerEtQuitter = { viewModel.terminerEtQuitter(::finish) },
                    showRegie = viewModel::showRegie,
                    hideRegie = viewModel::hideRegie,
                    removeRegies = viewModel::removeRegies,
                    showTablette = viewModel::showTablette,
                    hideTablette = viewModel::hideTablette,
                    confierTablette = viewModel::confierTablette,
                    checkUpdate = updates::show,
                    mimeStart = viewModel::mimeStart,
                    mimeFound = viewModel::mimeFound,
                    mimePass = viewModel::mimePass,
                    mimeSkip = viewModel::mimeSkip,
                    mimeStop = viewModel::mimeStop,
                    judgeBuzz = { ok -> viewModel.judgeBuzz(ok) },
                    blindReveal = viewModel::blindReveal,
                    blindSkip = viewModel::blindSkip,
                    chestRandom = viewModel::chestRandom,
                    potatoRandom = viewModel::potatoRandom,
                    statuesSongEnded = viewModel::statuesSongEnded,
                    duelPanShown = viewModel::duelPanShown,
                    chronoShown = viewModel::chronoShown,
                    givePoints = viewModel::givePoints,
                    requestAgain = viewModel::requestAgain,
                    viderCache = viewModel::viderCacheMedias,
                    changerDesign = {
                        val d = Look.design.suivant
                        Look.design = d
                        reglages.edit().putString(CLE_DESIGN, d.cle).apply()
                        // Les pupitres de la partie en cours suivent le nouveau design.
                        viewModel.publierDesign()
                        // Les sons suivent le design (sons sci-fi du Game Show).
                        com.littlemissparty.quiz.tv.habillage.Sons.recharger(this@MainActivity)
                    },
                ),
                update = UpdateScreen(
                    ui = updateUi, open = updateOpen, available = updateAvailable, offer = updateOffer, reglages = reglagesManquants,
                    actions = UpdateActions(
                        search = updates::search,
                        download = updates::download,
                        cancelDownload = updates::cancelDownload,
                        install = updates::install,
                        // Ouvert depuis l'écran de l'appli : Retour revient ici, plus sur le gestionnaire de fichiers.
                        openPermission = { ReglagesMiseAJour.ouvrir(this@MainActivity, Reglage.INSTALLER) },
                        ouvrirReglage = { r -> ReglagesMiseAJour.ouvrir(this@MainActivity, r) },
                        reglagesPlusTard = updates::reglagesPlusTard,
                        close = updates::hide,
                        acceptOffer = updates::acceptOffer,
                        declineOffer = updates::declineOffer,
                    ),
                ),
                vidage = vidage,
            )
            }
            // BONUS / MALUS de la régie, par-dessus le jeu sans rien arrêter (chrono, musique, pupitres).
            // Pas sur le podium (test du 30/10 : le BONUS d'une correction faite juste avant la fin restait sur les jauges).
            coup?.let { c ->
                key(c.id) {
                    if (Habillage.podium.value) LaunchedEffect(Unit) { viewModel.coupFini(c.id) }
                    else BonusMalus(c.nom, c.couleur.toColor(), c.delta, c.avant, c.apres) { viewModel.coupFini(c.id) }
                }
            }
            }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Retour des réglages Android ou de l'écran d'installation.
        updates.onResume()
    }
}

/**
 * Baloo 2 a des lignes très hautes (1,6 fois la taille du texte, contre 1,17 pour la police d'avant) : sans
 * interligne imposé, chaque texte des écrans grandissait d'un tiers et poussait le bas de l'écran hors de la TV
 * (code du salon, « Reprise automatique », boutons). On garde l'interligne d'avant, lettres centrées dans la ligne ;
 * les textes qui fixent le leur (habillage) ne changent pas.
 */
@Composable
private fun PoliceDesEcrans(contenu: @Composable () -> Unit) {
    // Taille de police de la TV ignorée : les écrans sont dessinés au millimètre pour 960 × 540. Sur une TV réglée en
    // « grande police » (TCL de cedric, 21/10), les textes grossissaient mais pas les cadres : noms d'équipe coupés
    // en bas des pastilles des mimes, textes décentrés dans les boutons.
    val d = LocalDensity.current
    CompositionLocalProvider(LocalDensity provides Density(d.density, 1f)) {
        AvecPoliceLmp {
            ProvideTextStyle(
                LocalTextStyle.current.merge(
                    TextStyle(lineHeight = 1.2.em, lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)),
                ),
                contenu,
            )
        }
    }
}

private const val PREFS_DESIGN = "lmp_design"
// Nouvelle clé le 22 octobre : chaque box repart une fois en « The Game Show », même si le Classique y avait été choisi.
// v3 (24 octobre) : chaque box repart une fois sur le nouveau design par défaut, le plateau 3D.
private const val CLE_DESIGN = "design-v3"
