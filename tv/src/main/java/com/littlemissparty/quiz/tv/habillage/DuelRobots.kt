package com.littlemissparty.quiz.tv.habillage

import android.content.Context
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.util.Log
import android.view.Surface
import android.view.TextureView
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlin.math.sin
import kotlin.random.Random

/*
 * 🤠 Le Duel des robots sur la TV (cedric, 27/10) : deux robots se défient du regard dans un western néon, feintent,
 * puis PAN ! Le montage du face-à-face (un plan toutes les 3 à 4 s, une feinte toutes les 8 à 12 s, jamais deux de
 * suite) est tiré d'avance pour chaque duel et s'arrête net au PAN, que seule la box connaît. Game Show : les plans
 * vidéo du western (res/raw/gs_duel_*.mp4) quand ils sont dans l'appli ; sinon, et en design classique, la scène est
 * dessinée. Les noms des équipes, le PAN et le résultat sont toujours écrits en direct par-dessus.
 */

/** Étape du duel à l'écran. */
enum class EtapeDuel { ATTENTE, PRET, FACE, PAN, GAGNE, TROP_TOT, PERSONNE }

/**
 * Un plan du montage du face-à-face : la vidéo gs_duel_<[nom]> à partir de [debutMs] après le début du face-à-face ;
 * [feinte] : le robot de gauche (0) ou de droite (1), [cote], fait mine de dégainer.
 */
internal data class PlanDuel(val debutMs: Long, val nom: String, val feinte: Boolean = false, val cote: Int = 0)

internal val PLANS_DUEL = listOf("large", "contre", "plongee", "bottes", "traverse", "horizon", "yeux", "yeux2", "main")
internal val FEINTES_DUEL = listOf("face", "dos", "cote")
internal const val FEINTE_DUEL_MS = 3_000L

/**
 * Le montage d'un face-à-face de [dureeMs] (du début au PAN), tiré avec [graine] (le même à chaque recomposition et
 * après un redémarrage de l'écran) : un plan toutes les 3 à 4 s, jamais le même deux fois de suite ; une feinte
 * toutes les 8 à 12 s, jamais deux de suite, jamais en premier plan. [plans] et [feintes] : ceux qu'on peut montrer
 * (les vidéos présentes dans l'appli).
 */
internal fun montageDuel(dureeMs: Long, graine: Int, plans: List<String> = PLANS_DUEL, feintes: List<String> = FEINTES_DUEL): List<PlanDuel> {
    val r = Random(graine)
    val montage = mutableListOf<PlanDuel>()
    var t = 0L
    var prochaineFeinte = r.nextLong(8_000, 12_001)
    var dernier: String? = null
    while (t < dureeMs) {
        val feinte = montage.isNotEmpty() && t >= prochaineFeinte && !montage.last().feinte && feintes.isNotEmpty()
        val choix = plans.ifEmpty { PLANS_DUEL }
        val nom = if (feinte) "feinte_" + feintes.random(r) else "plan_" + choix.filter { "plan_$it" != dernier }.ifEmpty { choix }.random(r)
        montage += PlanDuel(t, nom, feinte, r.nextInt(2))
        dernier = nom
        if (feinte) prochaineFeinte = t + r.nextLong(8_000, 12_001)
        t += if (feinte) FEINTE_DUEL_MS else r.nextLong(3_000, 4_001)
    }
    return montage
}

/** Le plan à l'écran [ecouleMs] après le début du face-à-face. */
internal fun planDuelA(montage: List<PlanDuel>, ecouleMs: Long): PlanDuel? = montage.lastOrNull { it.debutMs <= ecouleMs }

/** Nom de la vidéo du Game Show pour cette étape (sans « gs_duel_ »), [cote] : 0 à gauche, 1 à droite. */
internal fun videoDuel(etape: EtapeDuel, plan: PlanDuel?, cote: Int?): Pair<String, Boolean>? = when (etape) {
    EtapeDuel.ATTENTE -> null
    EtapeDuel.PRET -> "annonce" to true
    EtapeDuel.FACE -> plan?.let { it.nom to false }
    EtapeDuel.PAN -> "pan" to false
    EtapeDuel.GAGNE -> (if (cote == 1) "gagne_droite" else "gagne_gauche") to false
    EtapeDuel.TROP_TOT -> (if (cote == 1) "troptot_droite" else "troptot_gauche") to false
    EtapeDuel.PERSONNE -> "personne" to false
}

/** Une équipe du duel à l'écran : son nom, sa couleur, le joueur appelé. */
class EquipeDuel(val nom: String, val couleur: Color, val joueur: Int)

private val LARGEUR = 1600.dp
private val HAUTEUR = 700.dp
private val OR = listOf(Color(0xFFFFF7B0), Color(0xFFFFE600), Color(0xFFFFA51F))

/**
 * La scène du duel : le western (vidéo du Game Show ou décor dessiné), les deux robots face à face et leurs équipes,
 * le PAN, le résultat. [gagnante] / [perdante] : 0 (gauche) ou 1 (droite) une fois le duel jugé ; [plan] : le plan du
 * face-à-face en cours (feintes).
 */
@Composable
internal fun SceneDuel(
    equipes: List<EquipeDuel>,
    etape: EtapeDuel,
    gagnante: Int?,
    perdante: Int?,
    plan: PlanDuel?,
    cle: Any?,
    modifier: Modifier = Modifier,
    textes: TextesDuel? = null,
) {
    val video = if (Look.gs) videoDuel(etape, plan, if (etape == EtapeDuel.TROP_TOT) perdante else gagnante) else null
    var image by remember { mutableStateOf(false) }
    Box(modifier) {
        if (!image) DecorWestern(Modifier.fillMaxSize())
        if (Look.gs) VideoDuel(video, surImage = { image = it }, modifier = Modifier.fillMaxSize())
        BandesNoires(etape == EtapeDuel.FACE, Modifier.fillMaxSize())
        // Game Show : le film en plein écran et les textes de la maquette validée (pastille, annonce, PAN néon western).
        if (Look.gs && textes != null) HabillageDuelWestern(equipes, etape, gagnante, textes, cle)
        else EchelleSansCoupe(LARGEUR, HAUTEUR, Modifier.fillMaxSize()) {
            if (equipes.size == 2) {
                equipes.forEachIndexed { i, e ->
                    Column(
                        Modifier.align(if (i == 0) Alignment.BottomStart else Alignment.BottomEnd).padding(horizontal = 80.dp, vertical = 10.dp).width(520.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        // Robots dessinés seulement sans vidéo : sinon ceux du film sont à l'écran.
                        if (!image) Robot(i, etape, gagnante, perdante, plan, cle)
                        Spacer(Modifier.height(12.dp))
                        Plaque(e, gagne = gagnante == i && etape in setOf(EtapeDuel.GAGNE, EtapeDuel.TROP_TOT))
                    }
                }
            }
            val centre = Modifier.align(Alignment.Center).padding(bottom = 140.dp)
            when (etape) {
                EtapeDuel.PRET -> Text("CONTRE", maxLines = 1, softWrap = false, modifier = centre.apparition(200, cle), style = titre(90.sp))
                EtapeDuel.PAN -> Pan(centre, cle)
                else -> {}
            }
        }
    }
}

private fun titre(taille: androidx.compose.ui.unit.TextUnit) = TextStyle(
    brush = Brush.verticalGradient(OR), fontFamily = PoliceGsTitre, fontSize = taille, shadow = Shadow(Color(0xFFFF6B1A), Offset.Zero, 40f),
)

/**
 * Les bandes noires du cinéma (14 % de la hauteur chacune, cedric 27/10) : elles glissent une fois au début du
 * face-à-face (0,6 s, douces), restent pendant les plans et les feintes, et repartent au PAN (0,3 s).
 */
@Composable
private fun BandesNoires(face: Boolean, modifier: Modifier) {
    val v by animateFloatAsState(if (face) 1f else 0f, if (face) tween(600, easing = FastOutSlowInEasing) else tween(300), label = "bandes")
    if (v <= 0f) return
    Canvas(modifier.clearAndSetSemantics {}) {
        val h = size.height * 0.14f * v
        drawRect(Color.Black, size = size.copy(height = h))
        drawRect(Color.Black, topLeft = Offset(0f, size.height - h), size = size.copy(height = h))
    }
}

/** Les vidéos du duel présentes dans l'appli, parmi [noms] (fichiers gs_duel_<[prefixe]><nom>). */
@Composable
internal fun videosDuelPresentes(noms: List<String>, prefixe: String): List<String> {
    val context = LocalContext.current
    return remember(noms, prefixe) { noms.filter { context.resources.getIdentifier("gs_duel_$prefixe$it", "raw", context.packageName) != 0 } }
}

/** Le gros « PAN ! » : il claque à l'heure du PAN, avec un éclair blanc. */
@Composable
private fun Pan(modifier: Modifier, cle: Any?) {
    val eclair = remember(cle) { Animatable(0.85f) }
    LaunchedEffect(cle) { eclair.animateTo(0f, tween(350)) }
    Box(Modifier.fillMaxSize().graphicsLayer { alpha = eclair.value }.background(Color.White))
    Text("PAN !", maxLines = 1, softWrap = false, modifier = modifier.apparition(0, cle), style = titre(260.sp))
}

/** Le nom de l'équipe, sur une plaque à sa couleur (plus de « joueur n° », cedric 31/10). */
@Composable
private fun Plaque(e: EquipeDuel, gagne: Boolean) {
    Column(
        Modifier
            .background(Brush.verticalGradient(listOf(Neon.Nuit.copy(alpha = 0.9f), Neon.Nuit2.copy(alpha = 0.9f))), RoundedCornerShape(26.dp))
            .border(if (gagne) 6.dp else 3.dp, e.couleur, RoundedCornerShape(26.dp))
            .padding(horizontal = 28.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        NomUneLigne(e.nom.ifBlank { "Équipe" }, e.couleur, 52f, 460.dp)
    }
}

/** Un robot dessiné : il tremble quand il feinte, se dresse s'il gagne, tombe s'il perd. */
@Composable
private fun Robot(i: Int, etape: EtapeDuel, gagnante: Int?, perdante: Int?, plan: PlanDuel?, cle: Any?) {
    val feinte = etape == EtapeDuel.FACE && plan?.feinte == true && plan.cote == i
    val ms = horloge(plan to cle)
    val jugee = etape in setOf(EtapeDuel.GAGNE, EtapeDuel.TROP_TOT)
    Box(contentAlignment = Alignment.TopCenter) {
        Text(
            "🤖", maxLines = 1, softWrap = false,
            style = TextStyle(fontSize = 190.sp),
            modifier = Modifier.clearAndSetSemantics {}.graphicsLayer {
                val t = ms()
                translationX = if (feinte && t < 900f) sin(t / 28f) * 16f * density else 0f
                when {
                    jugee && gagnante == i -> { scaleX = 1.15f; scaleY = 1.15f }
                    jugee && perdante == i -> {
                        rotationZ = if (i == 0) -70f else 70f
                        translationY = 50f * density
                        alpha = 0.55f
                    }
                }
            },
        )
        if (feinte) Text("❗", maxLines = 1, softWrap = false, style = TextStyle(fontSize = 70.sp), modifier = Modifier.padding(top = 0.dp).apparition(0, plan))
        if (etape == EtapeDuel.PAN || (jugee && gagnante == i)) Text("💥", maxLines = 1, softWrap = false, style = TextStyle(fontSize = 80.sp), modifier = Modifier.align(if (i == 0) Alignment.CenterEnd else Alignment.CenterStart).apparition(0, etape))
    }
}

/** Le western dessiné : ciel du couchant, soleil sur l'horizon, sol de la grand-rue. */
@Composable
private fun DecorWestern(modifier: Modifier) {
    val ciel = if (Look.gs) listOf(GS.Noir, GS.VioletProfond, GS.Rose, GS.Orange) else listOf(Color(0xFF1A0B2E), Color(0xFF5A1E5C), Color(0xFFE0603A), Color(0xFFFFB347))
    Canvas(modifier.clearAndSetSemantics {}) {
        val horizon = size.height * 0.62f
        drawRect(Brush.verticalGradient(ciel, endY = horizon), size = size.copy(height = horizon))
        drawCircle(Brush.verticalGradient(OR, startY = horizon - size.height * 0.2f, endY = horizon), radius = size.height * 0.2f, center = Offset(size.width / 2, horizon))
        drawRect(
            Brush.verticalGradient(listOf(Color(0xFF3A1A10), Color(0xFF120806)), startY = horizon, endY = size.height),
            topLeft = Offset(0f, horizon), size = size.copy(height = size.height - horizon),
        )
        drawLine(if (Look.gs) GS.Cyan else Color(0xFFFFD27A), Offset(0f, horizon), Offset(size.width, horizon), strokeWidth = 4f)
    }
}

/**
 * La vidéo du Game Show pour l'étape ([nomEtBoucle] : nom sans « gs_duel_ », en boucle ou non) ; absente de l'appli
 * ou illisible : rien, la scène dessinée reste ([surImage] faux). Une seule vidéo à la fois : le plateau ne lit pas
 * son propre fond pendant le duel.
 */
@Composable
private fun VideoDuel(nomEtBoucle: Pair<String, Boolean>?, surImage: (Boolean) -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    val resId = remember(nomEtBoucle?.first) {
        nomEtBoucle?.let { context.resources.getIdentifier("gs_duel_${it.first}", "raw", context.packageName) } ?: 0
    }
    // Aucune vidéo du duel dans l'appli (pas encore livrées) : rien du tout, le plateau garde son fond.
    val livre = remember {
        (PLANS_DUEL.map { "plan_$it" } + "annonce" + "pan").any { context.resources.getIdentifier("gs_duel_$it", "raw", context.packageName) != 0 }
    }
    if (!livre) return
    DisposableEffect(Unit) {
        Habillage.videoDuel.value = true
        onDispose { Habillage.videoDuel.value = false }
    }
    LaunchedEffect(resId) { if (resId == 0) surImage(false) }
    AndroidView(
        factory = { LecteurDuel(it, surImage) },
        update = { if (resId != 0) it.jouer(resId, nomEtBoucle?.second == true) },
        onRelease = { it.liberer() },
        modifier = modifier.clearAndSetSemantics {},
    )
}

/**
 * Lecteur des plans du duel : une seule surface, un plan après l'autre. Entre deux plans, la dernière image reste à
 * l'écran jusqu'à la première du suivant (pas d'écran noir), et jamais deux décodeurs vidéo à la fois (Mi Box).
 * L'ancien lecteur est rendu hors du fil de l'écran ([Liberation]) et le suivant ne part qu'après : sur la Mi Box,
 * stop() et release() bloquaient l'image à chaque plan et au PAN (test du 27/10 au soir : saccades, PAN figé, affiché
 * jusqu'à 278 ms en retard).
 */
internal class LecteurDuel(context: Context, private val surImage: (Boolean) -> Unit) : TextureView(context), TextureView.SurfaceTextureListener {
    private var surface: Surface? = null
    private var lecteur: MediaPlayer? = null
    private var demande: Pair<Int, Boolean>? = null
    private var fini = false
    /** Change à chaque plan demandé : un lecteur rendu en retard ne lance jamais un plan dépassé. */
    private var generation = 0

    init {
        surfaceTextureListener = this
    }

    /** Joue la vidéo [resId] (en boucle si [boucle]) ; rien si c'est déjà elle. */
    fun jouer(resId: Int, boucle: Boolean) {
        if (demande == (resId to boucle)) return
        demande = resId to boucle
        lancer()
    }

    private fun lancer() {
        val s = surface ?: return
        if (demande == null || fini) return
        val jeton = ++generation
        val ancien = lecteur
        lecteur = null
        if (ancien == null) creer(s) else Liberation.lecteur(ancien, stop = true) {
            post { if (jeton == generation && !fini && surface === s) creer(s) }
        }
    }

    private fun creer(s: Surface) {
        val (resId, boucle) = demande ?: return
        try {
            lecteur = MediaPlayer().apply {
                context.resources.openRawResourceFd(resId).use { setDataSource(it.fileDescriptor, it.startOffset, it.length) }
                setSurface(s)
                isLooping = boucle
                setVolume(0f, 0f)
                setOnInfoListener { _, quoi, _ ->
                    if (quoi == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) surImage(true)
                    false
                }
                setOnErrorListener { _, quoi, extra ->
                    Log.w("Habillage", "Vidéo du duel ignorée : lecteur $quoi/$extra")
                    surImage(false)
                    true
                }
                setOnPreparedListener { mp -> if (!fini && lecteur === mp) mp.start() }
                prepareAsync()
            }
        } catch (e: Throwable) {
            Log.w("Habillage", "Vidéo du duel ignorée : ${e.message}")
            surImage(false)
        }
    }

    override fun onSurfaceTextureAvailable(st: SurfaceTexture, largeur: Int, hauteur: Int) {
        surface = Surface(st)
        lancer()
    }

    override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, largeur: Int, hauteur: Int) = Unit

    override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        val s = surface
        surface = null
        // La surface ne part qu'après le lecteur qui dessine dedans.
        arreter { s?.release() }
        if (!fini) surImage(false)
        return true
    }

    override fun onSurfaceTextureUpdated(st: SurfaceTexture) = Unit

    fun liberer() {
        fini = true
        arreter()
    }

    private fun arreter(apres: () -> Unit = {}) {
        generation++
        val l = lecteur
        lecteur = null
        if (l != null) Liberation.lecteur(l, stop = true, apres) else apres()
    }
}

/** Le résultat du duel en grand, au milieu : la gagnante, le tir trop tôt, ou personne. */
@Composable
fun BandeauDuel(texte: String, sousTitre: String?, couleur: Color, cle: Any?, modifier: Modifier = Modifier) {
    Column(
        modifier
            .background(Neon.Nuit.copy(alpha = 0.88f), RoundedCornerShape(30.dp))
            .border(4.dp, couleur, RoundedCornerShape(30.dp))
            .padding(horizontal = 40.dp, vertical = 18.dp)
            .apparition(0, cle),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(texte, maxLines = 2, style = styleCentre(54.sp, couleur))
        if (sousTitre != null) Text(sousTitre, maxLines = 1, softWrap = false, style = styleCentre(34.sp, Color.White))
    }
}
