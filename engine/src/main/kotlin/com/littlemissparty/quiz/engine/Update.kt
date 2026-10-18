package com.littlemissparty.quiz.engine

import org.json.JSONObject

/**
 * Version stable de l'appli TV publiée par GitHub Actions (branche main), décrite par `tv/latest.json`
 * sur l'hébergement Firebase : `{"versionCode", "versionName", "url", "sha256", "size", "notes"}`.
 */
data class Release(
    val versionCode: Long,
    val versionName: String,
    /** Adresse de l'APK, absolue ou relative à celle de `latest.json`. */
    val url: String,
    val sha256: String,
    val size: Long,
    val notes: String = "",
) {
    companion object {
        /** Lit `latest.json` ; une description incomplète ou incohérente est refusée. */
        fun parse(json: String): Release {
            val o = JSONObject(json)
            val r = Release(
                versionCode = o.getLong("versionCode"),
                versionName = o.getString("versionName"),
                url = o.getString("url"),
                sha256 = o.getString("sha256").lowercase(),
                size = o.getLong("size"),
                notes = o.optString("notes", ""),
            )
            require(r.versionCode > 0) { "versionCode invalide" }
            require(r.url.isNotBlank()) { "Adresse de l'APK manquante" }
            require(r.sha256.matches(Regex("^[0-9a-f]{64}$"))) { "Empreinte SHA-256 invalide" }
            require(r.size in 1..MAX_APK_BYTES) { "Taille de l'APK invalide" }
            return r
        }

        /** 200 Mo : au-delà, ce n'est pas notre APK (8 Mo aujourd'hui). */
        const val MAX_APK_BYTES = 200L * 1024 * 1024
    }

    fun isNewerThan(installedVersionCode: Long) = versionCode > installedVersionCode
}

/** Ce que la box lit dans l'APK téléchargé, avant de le confier à l'installateur d'Android. */
data class ApkFacts(
    val sha256: String,
    val size: Long,
    val packageName: String?,
    val versionCode: Long?,
    /** Empreintes SHA-256 des certificats de signature. */
    val signers: Set<String>,
)

enum class ApkProblem {
    /** Fichier incomplet ou abîmé pendant le téléchargement (taille ou empreinte différente). */
    CORRUPTED,
    /** Android ne sait pas lire le fichier comme une appli. */
    UNREADABLE,
    WRONG_PACKAGE,
    /** Pas plus récent que l'appli installée, ou pas la version annoncée. */
    WRONG_VERSION,
    /** Signé par une autre clé : Android refuserait de l'installer par-dessus (ou ce n'est pas notre appli). */
    WRONG_SIGNATURE,
}

/**
 * Vérifications faites par la box avant toute installation. La référence de signature est l'appli
 * installée elle-même : aucune clé à tenir à jour, et un APK d'une autre origine est toujours refusé.
 */
fun verifyApk(
    release: Release,
    apk: ApkFacts,
    packageName: String,
    installedVersionCode: Long,
    installedSigners: Set<String>,
): ApkProblem? = when {
    apk.size != release.size || !apk.sha256.equals(release.sha256, ignoreCase = true) -> ApkProblem.CORRUPTED
    apk.packageName == null || apk.versionCode == null -> ApkProblem.UNREADABLE
    apk.packageName != packageName -> ApkProblem.WRONG_PACKAGE
    apk.versionCode != release.versionCode || apk.versionCode <= installedVersionCode -> ApkProblem.WRONG_VERSION
    apk.signers.isEmpty() || installedSigners.isEmpty() || apk.signers != installedSigners -> ApkProblem.WRONG_SIGNATURE
    else -> null
}
