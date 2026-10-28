package com.littlemissparty.quiz.tv.test

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.littlemissparty.quiz.engine.Scoring
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream

/**
 * Quiz classique, photo montrée dès la question (« À quel pays est ce drapeau ? », cedric 28/10) : le drapeau s'affiche
 * en entier à gauche des réponses pendant la question, et reste à la révélation ; sans l'option, rien ne change.
 */
@RunWith(AndroidJUnit4::class)
class ImageDesLaQuestionTest : TestTv() {

    private val regies = mutableListOf<RegieSimulee>()
    private fun regie() = RegieSimulee().also { regies += it }

    @Before
    fun motDePasse() = RegieSimulee.definirMotDePasse()

    @After
    fun rangerRegies() = regies.forEach { it.close() }

    /** Le drapeau du Japon dessiné comme ceux du pack : 4:3, fond du Game Show, drapeau entier avec sa marge. */
    private fun drapeauJapon(): String {
        val b = Bitmap.createBitmap(800, 600, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        c.drawColor(Color.rgb(30, 18, 80))
        c.drawRect(56f, 87f, 744f, 513f, Paint().apply { color = Color.WHITE })
        c.drawCircle(400f, 300f, 128f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(188, 0, 45) })
        val out = ByteArrayOutputStream()
        b.compress(Bitmap.CompressFormat.JPEG, 85, out)
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    @Test
    fun leDrapeauEstVisibleDesLaQuestionSansChangerLesAutresQuestions() {
        val code = lancerBoite()
        val licornes = pupitre("licornes").also { it.rejoindre(code, "Licornes", VERT) }
        val regie = regie()
        assertTrue(regie.connecter(code, RegieSimulee.MOT_DE_PASSE))
        val drapeau = "0123456789abcdef"
        regie.copierPhoto(code, drapeau, drapeauJapon())
        @Suppress("UNCHECKED_CAST")
        val demo = regie.programme(code)["questions"] as List<Map<String, Any?>>
        val base = mapOf("duration" to 20, "kind" to "classic", "double" to false, "round" to "Drapeaux et pays")
        val pays = base + mapOf(
            "id" to "d1", "text" to "À quel pays est ce drapeau ?", "choices" to listOf("Japon", "Chine", "Italie", "Canada"),
            "correct" to 0, "imageId" to drapeau, "imageVisible" to true,
        )
        val capitale = base + mapOf(
            "id" to "d2", "text" to "Quelle est la capitale du Japon ?", "choices" to listOf("Tokyo", "Pékin", "Paris", "Rome"),
            "correct" to 0, "imageId" to drapeau,
        )
        // En panne : photo jamais copiée dans la partie ; la question se joue quand même.
        val sansPhoto = base + mapOf(
            "id" to "d3", "text" to "Et ce drapeau-là ?", "choices" to listOf("Suisse", "Canada"),
            "correct" to 0, "imageId" to "fedcba9876543210", "imageVisible" to true,
        )
        assertEquals("applied", regie.modifierProgramme(code, regie.programme(code)["rev"] as String, listOf(pays, capitale, sansPhoto) + demo))

        // Le drapeau est là pendant la question, avant toute réponse.
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("question du drapeau ouverte") { licornes.etat(code).takeIf { it.child("qid").value == "d1" && it.child("phase").value == "question" } }
        ecran.voit("Image de la question")
        ecran.voit("Japon")
        ecran.capture("drapeau-des-la-question", attente = 1_500)
        assertTrue(licornes.repondre(code, "d1", 0))
        ecran.voit("Toutes les équipes ont répondu")
        assertEquals("applied", regie.commande(code, "next"))
        attendreQue("points du QCM") { points(licornes, code, licornes.uid).takeIf { it >= Scoring.BASE } }
        // Il reste en place à la révélation.
        ecran.voit("Image de la question")
        ecran.capture("drapeau-revelation", attente = Ecran.APRES_REVELATION)

        // Sans l'option : comme avant, la photo n'arrive qu'avec la bonne réponse.
        attendreQue("question de la capitale ouverte", 30_000) {
            val e = licornes.etat(code)
            if (e.child("qid").value == "d2" && e.child("phase").value == "question") true else { regie.commande(code, "next"); null }
        }
        ecran.voit("Quelle est la capitale du Japon ?")
        ecran.neVoitPas("Illustration de la réponse", 3_000)
        ecran.neVoitPas("Image de la question", 3_000)
        assertTrue(licornes.repondre(code, "d2", 0))
        ecran.voit("Toutes les équipes ont répondu")
        assertEquals("applied", regie.commande(code, "next"))
        ecran.voit("Illustration de la réponse")

        // Photo absente : la question se joue, les réponses restent à leur place.
        attendreQue("question sans photo ouverte", 30_000) {
            val e = licornes.etat(code)
            if (e.child("qid").value == "d3" && e.child("phase").value == "question") true else { regie.commande(code, "next"); null }
        }
        ecran.voit("Et ce drapeau-là ?")
        ecran.voit("Suisse")
        assertTrue(licornes.repondre(code, "d3", 0))
        ecran.voit("Toutes les équipes ont répondu")
        ecran.capture("drapeau-photo-absente")
    }
}
