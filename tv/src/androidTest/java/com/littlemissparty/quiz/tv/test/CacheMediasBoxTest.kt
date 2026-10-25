package com.littlemissparty.quiz.tv.test

import android.util.Base64
import android.view.KeyEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.littlemissparty.quiz.tv.habillage.Look
import java.io.File
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Le cache des médias de la box : ménage tout seul au salon d'attente, « Vider le cache des médias » à la télécommande. */
@RunWith(AndroidJUnit4::class)
class CacheMediasBoxTest : TestTv() {

    private val regies = mutableListOf<RegieSimulee>()

    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    @After
    fun rangerRegies() = regies.forEach { it.close() }

    /** Menu Retour, puis la flèche du bas bouton par bouton jusqu'à « Vider le cache des médias ». */
    private fun ouvrirViderLeCache() {
        ecran.device.pressBack()
        ecran.focusSur("Continuer la partie")
        listOf("Donner des points", "Reconnecter la régie", "Reconnecter une tablette", "Rechercher une mise à jour", "Vider le cache des médias")
            .forEach { bouton ->
                ecran.touche(KeyEvent.KEYCODE_DPAD_DOWN)
                ecran.focusSur(bouton)
            }
        ecran.ok("Vider le cache des médias")
        ecran.voit("Les musiques et les photos gardées sur la box seront effacées.")
        // Rien ne s'efface sans un second choix : « Annuler » a la sélection.
        ecran.focusSur("Annuler")
    }

    @Test
    fun menageAuSalonPuisViderLeCacheALaTelecommandeEtLaPartieRecopieSesMusiques() {
        // Médias d'anciennes fêtes : une chanson oubliée depuis 200 jours, une chanson et une photo d'hier.
        val extraits = File(Boite.contexte.filesDir, "extraits").apply { mkdirs() }
        val photos = File(Boite.contexte.filesDir, "photos").apply { mkdirs() }
        val oubliee = File(extraits, "00000000000000aa.mp3").apply {
            writeBytes(ByteArray(2_000))
            setLastModified(System.currentTimeMillis() - 200L * 24 * 60 * 60 * 1000)
        }
        val hier = File(extraits, "00000000000000bb.mp3").apply { writeBytes(ByteArray(2_000)) }
        val photoHier = File(photos, "00000000000000cc").apply { writeBytes(ByteArray(500)) }

        val code = lancerBoite()
        val regie = RegieSimulee().also { regies += it }
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        // Un morceau de blind test au programme, son extrait copié par la régie comme d'habitude.
        val id = java.security.MessageDigest.getInstance("SHA-256").digest(EXTRAIT_MP3.toByteArray()).take(8).joinToString("") { "%02x".format(it) }
        regie.copierExtrait(code, id, EXTRAIT_MP3)
        @Suppress("UNCHECKED_CAST")
        val avant = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val morceau = mapOf(
            "id" to "b1", "text" to "Quel est ce titre ?", "choices" to listOf("Frère Jacques"), "correct" to 0, "artist" to "Comptine",
            "duration" to 20, "kind" to "blind", "double" to false, "round" to "Blind test · Comptines", "audioId" to id, "points" to 100,
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(morceau) + avant))
        val extrait = File(extraits, "$id.mp3")
        attendreQue("extrait copié dans le cache de la box") { extrait.takeIf { it.isFile && it.length() > 0 } }

        // Au salon d'attente, le ménage passe une fois : la chanson oubliée part, le reste ne bouge pas.
        attendreQue("chanson oubliée effacée par le ménage", 60_000) { true.takeIf { !oubliee.exists() } }
        assertTrue("chanson d'hier gardée", hier.exists())
        assertTrue("photo d'hier gardée", photoHier.exists())
        assertTrue("extrait de la partie gardé", extrait.exists())

        // « Annuler » (la sélection par défaut) : rien n'est effacé.
        ouvrirViderLeCache()
        ecran.entierementVisible("Les prestations, les scores et les réglages ne sont pas touchés.")
        ecran.capture("vider-le-cache-question")
        ecran.device.pressDPadCenter()
        ecran.neVoitPas("Les musiques et les photos gardées sur la box seront effacées.")
        assertTrue(hier.exists())
        assertTrue(photoHier.exists())

        // Extrait de la partie abîmé exprès : seul un nouveau téléchargement peut le réparer.
        extrait.writeBytes("abîmé".toByteArray())
        ouvrirViderLeCache()
        ecran.touche(KeyEvent.KEYCODE_DPAD_RIGHT)
        ecran.ok("Vider le cache")
        ecran.voit("Cache vidé")
        ecran.entierementVisible("Les musiques et les photos de la partie se retéléchargent toutes seules.")
        ecran.capture("vider-le-cache-fait")
        assertFalse("chanson d'hier effacée", hier.exists())
        assertFalse("photo d'hier effacée", photoHier.exists())
        // La partie recopie aussitôt son extrait depuis sa copie dans Firebase ; la régie le voit prêt.
        val mp3 = Base64.decode(EXTRAIT_MP3.substringAfter("base64,"), Base64.DEFAULT)
        attendreQue("extrait de la partie retéléchargé") { extrait.takeIf { it.isFile && it.readBytes().contentEquals(mp3) } }
        assertArrayEquals(mp3, extrait.readBytes())
        attendreQue("la régie voit l'extrait prêt") { regie.extraitPret(code, id)?.takeIf { it == "ok" } }
        // La partie et les réglages de la box ne bougent pas.
        assertEquals(code, Boite.codeActif())
        ecran.ok("Fermer")
        ecran.neVoitPas("Vider le cache des médias")
        ecran.voit("Scannez pour jouer")
        if (!Look.gs) ecran.voit(code)
    }
}
