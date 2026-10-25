package com.littlemissparty.quiz.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class UpdateTest {

    private val sha = "a".repeat(64)
    private val pkg = "com.littlemissparty.quiz.tv"
    private val key = setOf("b".repeat(64))
    private val release = Release(60, "0.1.60", "little-miss-party-quiz-tv-60.apk", sha, 8_432_923)
    private val good = ApkFacts(sha, 8_432_923, pkg, 60, key)

    @Test
    fun `lecture de latest json publié par GitHub Actions`() {
        val r = Release.parse(
            """{"versionCode":60,"versionName":"0.1.60","url":"little-miss-party-quiz-tv-60.apk","sha256":"${sha.uppercase()}","size":8432923,"notes":"Lot 2"}""",
        )
        assertEquals(release.copy(notes = "Lot 2"), r)
        assertTrue(r.isNewerThan(57))
        assertFalse(r.isNewerThan(60))
    }

    @Test
    fun `une description abîmée est refusée`() {
        val base = """"versionName":"x","url":"a.apk","size":10"""
        assertFailsWith<Exception> { Release.parse("""{"versionCode":60,$base}""") }
        assertFailsWith<IllegalArgumentException> { Release.parse("""{"versionCode":60,"sha256":"1234",$base}""") }
        assertFailsWith<IllegalArgumentException> { Release.parse("""{"versionCode":0,"sha256":"$sha",$base}""") }
        assertFailsWith<Exception> { Release.parse("<html>Page introuvable</html>") }
    }

    @Test
    fun `une appli de plusieurs centaines de Mo est acceptée, jusqu'à 2 Go`() {
        fun avecTaille(size: Long) = Release.parse(
            """{"versionCode":569,"versionName":"0.1.569","url":"a.apk","sha256":"$sha","size":$size}""",
        )
        assertEquals(274_137_157, avecTaille(274_137_157).size, "La 0.1.569 était refusée par la limite de 200 Mo")
        assertEquals(Release.MAX_APK_BYTES, avecTaille(Release.MAX_APK_BYTES).size)
        assertFailsWith<IllegalArgumentException> { avecTaille(Release.MAX_APK_BYTES + 1) }
        assertFailsWith<IllegalArgumentException> { avecTaille(0) }
    }

    @Test
    fun `place à prévoir sur la box, deux copies de l'APK plus la marge`() {
        val r = release.copy(size = 274_137_157)
        assertEquals(2 * 274_137_157L + UPDATE_SPARE_BYTES, r.spaceNeeded())
        assertTrue(r.spaceNeeded() < 1_300_000_000, "La Mi Box de cedric (1,3 Go libres) peut se mettre à jour")
    }

    @Test
    fun `l'APK attendu, plus récent, signé par la même clé, est accepté`() {
        assertNull(verifyApk(release, good, pkg, 57, key))
    }

    @Test
    fun `fichier incomplet ou abîmé`() {
        assertEquals(ApkProblem.CORRUPTED, verifyApk(release, good.copy(size = 100), pkg, 57, key))
        assertEquals(ApkProblem.CORRUPTED, verifyApk(release, good.copy(sha256 = "c".repeat(64)), pkg, 57, key))
        assertEquals(ApkProblem.UNREADABLE, verifyApk(release, good.copy(packageName = null), pkg, 57, key))
    }

    @Test
    fun `autre appli, version non plus récente, autre signature`() {
        assertEquals(ApkProblem.WRONG_PACKAGE, verifyApk(release, good.copy(packageName = "com.pirate"), pkg, 57, key))
        assertEquals(ApkProblem.WRONG_VERSION, verifyApk(release, good, pkg, 60, key))
        assertEquals(ApkProblem.WRONG_VERSION, verifyApk(release, good.copy(versionCode = 59), pkg, 57, key))
        assertEquals(ApkProblem.WRONG_SIGNATURE, verifyApk(release, good.copy(signers = setOf("d".repeat(64))), pkg, 57, key))
        assertEquals(ApkProblem.WRONG_SIGNATURE, verifyApk(release, good.copy(signers = emptySet()), pkg, 57, key))
    }

    @Test
    fun `proposition automatique, seulement une version plus récente, pas deux fois après Plus tard`() {
        assertEquals(release, releaseToOffer(release, 57, null))
        assertNull(releaseToOffer(release, release.versionCode, null), "Déjà installée")
        assertNull(releaseToOffer(null, 57, null), "Serveur injoignable : rien à proposer")
        assertNull(releaseToOffer(release, 57, release.versionCode), "Plus tard : on ne la repropose pas")
        val newer = release.copy(versionCode = release.versionCode + 1)
        assertEquals(newer, releaseToOffer(newer, 57, release.versionCode), "Une version encore plus récente est reproposée")
    }
}
