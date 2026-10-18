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
}
