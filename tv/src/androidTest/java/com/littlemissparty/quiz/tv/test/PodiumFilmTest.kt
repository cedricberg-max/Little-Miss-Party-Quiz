package com.littlemissparty.quiz.tv.test

import android.os.SystemClock
import android.util.Log
import android.view.ViewTreeObserver
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.BroadcastFrameClock
import androidx.compose.runtime.Recomposer
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.littlemissparty.quiz.tv.habillage.Classee
import com.littlemissparty.quiz.tv.habillage.PodiumGameShow
import com.littlemissparty.quiz.tv.habillage.Tempo
import com.littlemissparty.quiz.tv.habillage.podiumSansVideos
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Delay
import kotlinx.coroutines.DisposableHandle
import kotlinx.coroutines.InternalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.resume

/**
 * Film d'aperçu du podium du Game Show, fluide (cedric, 30/10 : l'émulateur ne le dessine qu'à environ 10 images/s, le
 * premier film saccadait). Le podium tourne sur une horloge pas à pas : 25 images/s exactes, chaque image dessinée en
 * prenant son temps. Les deux vidéos sont remplacées par un fond uni, noir puis blanc à chaque image : la différence
 * des deux captures donne la transparence des textes, incrustés ensuite sur les vraies vidéos avec la musique.
 *
 * Passage complet (classe demandée seule) : tout le podium jusqu'à [FILM_MS]. Dans les autres passages : 2 s, pour
 * vérifier que l'horloge pas à pas fait bien avancer le podium, sans garder les images.
 */
@RunWith(AndroidJUnit4::class)
class PodiumFilmTest : TestTv() {

    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device = UiDevice.getInstance(instrumentation)

    @After
    fun remettreLesVideos() {
        podiumSansVideos = false
    }

    @Test
    fun podiumImageParImage() {
        val complet = InstrumentationRegistry.getArguments().getString("class").orEmpty().contains("PodiumFilmTest")
        val images = ((if (complet) FILM_MS else 2_000L) / PAS_MS).toInt()
        val scenario = Boite.lancer()
        ecran.voit("Scannez pour jouer", 30_000)

        podiumSansVideos = true
        val temps = TempsPasAPas()
        val horloge = BroadcastFrameClock()
        val recomposer = Recomposer(temps + horloge)
        val portee = CoroutineScope(temps + horloge + Job())
        val blanc = mutableStateOf(false)
        val dessins = AtomicInteger()
        val classement = listOf(
            Classee("Licornes", couleur(VERT), 120),
            Classee("Dragons", couleur(ROSE), 70),
            Classee("Chats", couleur("#FFE600"), 40),
        )
        scenario.onActivity { activite ->
            val vue = ComposeView(activite).apply {
                setParentCompositionContext(recomposer)
                setContent {
                    Box(Modifier.fillMaxSize().drawBehind { drawRect(if (blanc.value) Color.White else Color.Black) }) {
                        PodiumGameShow(classement)
                    }
                }
            }
            activite.setContentView(vue)
            vue.viewTreeObserver.addOnDrawListener(ViewTreeObserver.OnDrawListener { dessins.incrementAndGet() })
            portee.launch { recomposer.runRecomposeAndApplyChanges() }
            temps.vider()
        }

        val dossier = if (complet) Ecran.DOSSIER_CAPTURES else "${Ecran.DOSSIER_CAPTURES}/film-essai"
        device.executeShellCommand("mkdir -p $dossier")
        var noirPrecedent = -1L
        var changements = 0
        for (k in 0 until images) {
            surLeFil {
                temps.avancer(k * PAS_MS)
                Snapshot.sendApplyNotifications()
                temps.vider()
                horloge.sendFrame(k * PAS_MS * 1_000_000L)
                temps.vider()
                Snapshot.sendApplyNotifications()
            }
            attendreLeDessin(dessins)
            device.executeShellCommand("screencap -p $dossier/film-noir-%04d.png".format(k))
            surLeFil { blanc.value = true; Snapshot.sendApplyNotifications() }
            attendreLeDessin(dessins)
            device.executeShellCommand("screencap -p $dossier/film-blanc-%04d.png".format(k))
            surLeFil { blanc.value = false; Snapshot.sendApplyNotifications() }
            // Le podium bouge d'une image à l'autre (logo qui apparaît, titre qui pulse) : l'horloge avance bien.
            val taille = device.executeShellCommand("stat -c %%s $dossier/film-noir-%04d.png".format(k)).trim().toLongOrNull() ?: -1L
            if (taille != noirPrecedent) changements++
            noirPrecedent = taille
            if (k % 25 == 0) Log.i(TAG, "Film du podium : ${k * PAS_MS} ms")
        }
        assertEquals("horloge pas à pas", images * PAS_MS - PAS_MS, temps.maintenant)
        assertTrue("le podium ne bouge pas d'une image à l'autre ($changements changements)", changements >= images / 3)
        surLeFil { portee.cancel(); recomposer.cancel() }
        if (!complet) device.executeShellCommand("rm -r $dossier")
    }

    private fun surLeFil(bloc: () -> Unit) = instrumentation.runOnMainSync(bloc)

    /** Une image dessinée après le changement, puis le temps qu'elle arrive à l'écran (émulateur sans carte graphique). */
    private fun attendreLeDessin(dessins: AtomicInteger) {
        val avant = dessins.get()
        val limite = SystemClock.uptimeMillis() + 3_000
        while (dessins.get() == avant && SystemClock.uptimeMillis() < limite) SystemClock.sleep(10)
        instrumentation.waitForIdleSync()
        SystemClock.sleep(200)
    }

    private fun couleur(hex: String) = Color(android.graphics.Color.parseColor(hex))

    /**
     * Temps des coroutines du podium (delay, apparitions, robot, confettis) qui n'avance qu'à la demande : tout tourne
     * sur le fil principal, quand le test le décide.
     */
    @OptIn(InternalCoroutinesApi::class)
    private class TempsPasAPas : CoroutineDispatcher(), Delay {
        private class Minuterie(val a: Long, val ordre: Long, val bloc: Runnable)

        var maintenant = 0L
            private set
        private var ordre = 0L
        private val prets = ArrayDeque<Runnable>()
        private val minuteries = mutableListOf<Minuterie>()

        override fun dispatch(context: CoroutineContext, block: Runnable) {
            prets.addLast(block)
        }

        override fun scheduleResumeAfterDelay(timeMillis: Long, continuation: CancellableContinuation<Unit>) {
            val m = programmer(timeMillis) { continuation.resume(Unit) }
            continuation.invokeOnCancellation { minuteries.remove(m) }
        }

        override fun invokeOnTimeout(timeMillis: Long, block: Runnable, context: CoroutineContext): DisposableHandle {
            val m = programmer(timeMillis) { block.run() }
            return DisposableHandle { minuteries.remove(m) }
        }

        private fun programmer(dans: Long, bloc: Runnable) =
            Minuterie(maintenant + dans.coerceAtLeast(0), ordre++, bloc).also { minuteries += it }

        fun avancer(jusqua: Long) {
            vider()
            while (true) {
                val m = minuteries.filter { it.a <= jusqua }.minWithOrNull(compareBy({ it.a }, { it.ordre })) ?: break
                minuteries.remove(m)
                maintenant = m.a
                m.bloc.run()
                vider()
            }
            maintenant = jusqua
        }

        fun vider() {
            var n = 0
            while (prets.isNotEmpty()) {
                prets.removeFirst().run()
                check(++n < 1_000_000) { "coroutines du podium sans fin" }
            }
        }
    }

    companion object {
        /** 25 images par seconde. */
        const val PAS_MS = 40L

        /** Le podium jusqu'à 10 s après le solo (la fête et le début de sa boucle). */
        val FILM_MS = Tempo.PODIUM_REVELATION + 10_000L
    }
}
