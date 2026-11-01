package com.littlemissparty.quiz.tv

import android.app.Application
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.storage.StorageManager
import android.provider.Settings
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.littlemissparty.quiz.engine.ApkFacts
import com.littlemissparty.quiz.engine.ApkProblem
import com.littlemissparty.quiz.engine.InvalidReleaseException
import com.littlemissparty.quiz.engine.Release
import com.littlemissparty.quiz.engine.releaseToOffer
import com.littlemissparty.quiz.engine.verifyApk
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** Étapes de la mise à jour, affichées dans la fenêtre « Rechercher une mise à jour ». */
sealed interface UpdateUi {
    data object Idle : UpdateUi
    data object Checking : UpdateUi
    data object UpToDate : UpdateUi
    data class Available(val release: Release) : UpdateUi
    /** [essai] : nouvel essai après une coupure (0 au premier), [raison] : ce qui a coupé, en clair. */
    data class Downloading(val release: Release, val done: Long, val essai: Int = 0, val raison: String? = null) : UpdateUi
    data class Verifying(val release: Release) : UpdateUi
    data class Ready(val release: Release) : UpdateUi
    /** Android doit d'abord autoriser l'appli à installer des mises à jour (une seule fois). */
    data class NeedsPermission(val release: Release) : UpdateUi
    data class Installing(val release: Release) : UpdateUi
    /** [release] nul : l'échec vient de la recherche ; sinon « Réessayer » relance le téléchargement. */
    data class Failed(val message: String, val release: Release?) : UpdateUi
}

/**
 * Mise à jour de l'appli depuis la TV. Aucune installation n'est jamais lancée sans l'animatrice :
 * la box cherche seule une nouvelle version (un petit fichier) au démarrage puis régulièrement, et la
 * propose dans une fenêtre hors partie ; elle ne télécharge et n'installe que si l'animatrice accepte,
 * et jamais pendant une partie (l'écran le signale avec [setBusy]).
 *
 * Source : `tv/latest.json` et l'APK, publiés sur l'hébergement Firebase par GitHub Actions à chaque
 * version stable (branche main). Le dépôt GitHub est privé : la box ne pourrait pas lire ses Releases
 * sans un jeton, qu'on ne met jamais dans l'APK.
 */
class UpdateViewModel(app: Application) : AndroidViewModel(app) {

    private val _ui = MutableStateFlow<UpdateUi>(UpdateUi.Idle)
    val ui: StateFlow<UpdateUi> = _ui
    private val _open = MutableStateFlow(false)
    val open: StateFlow<Boolean> = _open
    /** Version plus récente trouvée par la recherche automatique, signalée en petit dans un coin. */
    private val _available = MutableStateFlow<Release?>(null)
    val available: StateFlow<Release?> = _available
    /** Version à proposer d'elle-même dans une fenêtre, dès qu'aucune partie n'est en cours. */
    private val _offer = MutableStateFlow<Release?>(null)
    val offer: StateFlow<Release?> = _offer
    /** « Plus tard » : cette version n'est plus proposée avant le prochain lancement. */
    private var declined: Long? = null
    /** « Installer maintenant » : on enchaîne téléchargement, vérification et installation. */
    private var autoInstall = false
    private var busy = false

    private var job: Job? = null
    private val dir = File(app.filesDir, "updates")
    private val installed: Long = BuildConfig.VERSION_CODE.toLong()

    init {
        cleanup()
        viewModelScope.launch {
            // Recherche discrète après le démarrage puis régulièrement, sans rien télécharger.
            delay(AUTO_CHECK_DELAY_MS)
            while (true) {
                autoCheck()
                delay(RECHECK_MS)
            }
        }
        viewModelScope.launch {
            InstallEvents.results.collect { onInstallResult(it) }
        }
    }

    private suspend fun autoCheck() {
        // Fenêtre ouverte ou téléchargement en cours : l'animatrice est déjà dans la mise à jour.
        val s = _ui.value
        if (_open.value || !(s is UpdateUi.Idle || s is UpdateUi.UpToDate || s is UpdateUi.Failed)) return
        val r = runCatching { fetchRelease() }.getOrNull()?.takeIf { it.isNewerThan(installed) } ?: return
        _available.value = r
        _offer.value = releaseToOffer(r, installed, declined)
    }

    /** Partie en cours sur la TV : rien ne s'installe, la proposition attend le retour à l'accueil. */
    fun setBusy(value: Boolean) {
        busy = value
    }

    /** « Installer maintenant » dans la fenêtre de proposition. */
    fun acceptOffer() {
        _offer.value ?: return
        _offer.value = null
        autoInstall = true
        _open.value = true
        when (val s = _ui.value) {
            is UpdateUi.Ready -> install()
            is UpdateUi.Available -> download()
            is UpdateUi.Failed -> if (s.release != null) download() else search()
            is UpdateUi.Downloading, is UpdateUi.Verifying, is UpdateUi.Installing, is UpdateUi.NeedsPermission -> Unit
            else -> search()
        }
    }

    /** « Plus tard » : la version reste signalée dans le coin et dans « Rechercher une mise à jour ». */
    fun declineOffer() {
        declined = _offer.value?.versionCode ?: return
        _offer.value = null
    }

    fun show() {
        _offer.value = null
        _open.value = true
        val s = _ui.value
        if (s is UpdateUi.Idle || s is UpdateUi.UpToDate || (s is UpdateUi.Failed && s.release == null)) search()
    }

    fun hide() {
        _open.value = false
        autoInstall = false
        // Installateur d'Android quitté sans réponse : on pourra relancer l'installation.
        (_ui.value as? UpdateUi.Installing)?.let { _ui.value = UpdateUi.Ready(it.release) }
    }

    fun search() {
        job?.cancel()
        _ui.value = UpdateUi.Checking
        job = viewModelScope.launch {
            _ui.value = try {
                val r = fetchRelease()
                if (!r.isNewerThan(installed)) {
                    _available.value = null
                    UpdateUi.UpToDate
                } else {
                    _available.value = r
                    if (verified(r) == null) UpdateUi.Ready(r) else UpdateUi.Available(r)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: InvalidReleaseException) {
                Log.w(TAG, "Version annoncée refusée", e)
                UpdateUi.Failed("La version annoncée sur le serveur est refusée par la box (${e.message}). Installez-la à la main.", null)
            } catch (e: Exception) {
                Log.w(TAG, "Recherche de mise à jour", e)
                UpdateUi.Failed("Impossible de joindre le serveur des mises à jour. Vérifiez la connexion Internet de la box.", null)
            }
            continueAutoInstall()
        }
    }

    /** Après « Installer maintenant » : étape suivante sans nouvel appui, jamais pendant une partie. */
    private fun continueAutoInstall() {
        if (!autoInstall || busy || !_open.value) return
        when (_ui.value) {
            is UpdateUi.Available -> download()
            is UpdateUi.Ready -> install()
            else -> Unit
        }
    }

    fun download() {
        val r = when (val s = _ui.value) {
            is UpdateUi.Available -> s.release
            is UpdateUi.Failed -> s.release ?: return search()
            else -> return
        }
        val previous = job
        _ui.value = UpdateUi.Downloading(r, 0)
        job = viewModelScope.launch {
            try {
                // Un téléchargement annulé doit avoir fini d'écrire avant qu'un autre reprenne le même fichier.
                previous?.cancelAndJoin()
                dir.mkdirs()
                // Un téléchargement repris occupe déjà sa part de la place nécessaire.
                val (needed, free) = withContext(Dispatchers.IO) { r.spaceNeeded() - alreadyDownloaded(r) to freeBytes() }
                if (free < needed) {
                    _ui.value = UpdateUi.Failed(
                        "Pas assez de place libre sur la box : il faut ${mo(needed)} Mo, il reste ${mo(free)} Mo. " +
                            "Videz le cache des médias (menu Retour) puis réessayez.",
                        r,
                    )
                    return@launch
                }
                telechargerAvecPatience(r)
                _ui.value = UpdateUi.Verifying(r)
                val problem = verified(r)
                _ui.value = if (problem == null) {
                    UpdateUi.Ready(r)
                } else {
                    apkFile(r).delete()
                    UpdateUi.Failed(problemMessage(problem), r)
                }
                continueAutoInstall()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "Téléchargement de la mise à jour", e)
                _ui.value = UpdateUi.Failed(
                    "Le téléchargement n'a pas abouti après $ESSAIS_TELECHARGEMENT essais (${raisonEnClair(e)}). " +
                        "${mo(alreadyDownloaded(r))} Mo sur ${mo(r.size)} sont déjà reçus : « Réessayer » reprend là où il s'est arrêté.",
                    r,
                )
            }
        }
    }

    /** Annule un téléchargement en cours ; la partie déjà reçue est gardée pour reprendre plus tard. */
    fun cancelDownload() {
        val s = _ui.value as? UpdateUi.Downloading ?: return
        job?.cancel()
        _ui.value = UpdateUi.Available(s.release)
    }

    fun install() {
        val r = when (val s = _ui.value) {
            is UpdateUi.Ready -> s.release
            is UpdateUi.NeedsPermission -> s.release
            else -> return
        }
        autoInstall = false
        val app = getApplication<Application>()
        if (!app.packageManager.canRequestPackageInstalls()) {
            _ui.value = UpdateUi.NeedsPermission(r)
            return
        }
        _ui.value = UpdateUi.Installing(r)
        viewModelScope.launch {
            try {
                // Dernière vérification juste avant de confier le fichier à Android.
                val problem = verified(r)
                if (problem != null) {
                    apkFile(r).delete()
                    _ui.value = UpdateUi.Failed(problemMessage(problem), r)
                    return@launch
                }
                withContext(Dispatchers.IO) { commitSession(app, apkFile(r)) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.e(TAG, "Installation de la mise à jour", e)
                _ui.value = UpdateUi.Failed("Android n'a pas pu lancer l'installation. Réessayez.", r)
            }
        }
    }

    /** Ouvre le réglage Android « Sources inconnues » pour cette appli. Faux si la box ne le propose pas. */
    fun openInstallPermission(): Boolean {
        val app = getApplication<Application>()
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${app.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching { app.startActivity(intent) }.isSuccess
    }

    /** Retour sur l'appli (après les réglages Android ou l'écran d'installation). */
    fun onResume() {
        val s = _ui.value
        if (s is UpdateUi.NeedsPermission && getApplication<Application>().packageManager.canRequestPackageInstalls()) {
            _ui.value = UpdateUi.Ready(s.release)
        }
    }

    private fun onInstallResult(result: InstallResult) {
        val r = (_ui.value as? UpdateUi.Installing)?.release ?: return
        _ui.value = when (result.status) {
            // L'utilisateur a refusé sur l'écran d'Android : rien n'a changé, on peut recommencer.
            PackageInstaller.STATUS_FAILURE_ABORTED -> UpdateUi.Ready(r)
            PackageInstaller.STATUS_SUCCESS -> UpdateUi.Idle
            PackageInstaller.STATUS_FAILURE_STORAGE -> UpdateUi.Failed("Pas assez de place sur la box pour installer la mise à jour.", r)
            PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
                UpdateUi.Failed("Android refuse cette version sur la box (${result.message ?: "incompatible"}).", r)
            else -> UpdateUi.Failed("L'installation n'a pas abouti${result.message?.let { " ($it)" } ?: ""}. Réessayez.", r)
        }
    }

    // ---------- Réseau et fichiers ----------

    private fun manifestUrl() = BuildConfig.UPDATE_URL

    private suspend fun fetchRelease(): Release = withContext(Dispatchers.IO) {
        val conn = connect(URL(manifestUrl()))
        val json = try {
            check(conn.responseCode == 200) { "HTTP ${conn.responseCode}" }
            conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
        try {
            Release.parse(json)
        } catch (e: Exception) {
            throw InvalidReleaseException(e.message ?: "description illisible", e)
        }
    }

    /**
     * Place qu'Android peut donner à l'appli sur le stockage des mises à jour : il garde lui-même une réserve
     * (quelques centaines de Mo sur une Mi Box) et sait vider les caches des applis pour en faire.
     */
    private fun freeBytes(): Long = runCatching {
        val sm = getApplication<Application>().getSystemService(StorageManager::class.java)
        sm.getAllocatableBytes(sm.getUuidForPath(dir))
    }.getOrElse { dir.usableSpace }

    private fun apkUrl(r: Release): URL {
        val url = URL(URL(manifestUrl()), r.url)
        require(BuildConfig.DEBUG || url.protocol == "https") { "Adresse non sécurisée" }
        return url
    }

    private fun apkFile(r: Release) = File(dir, "lmp-tv-${r.versionCode}.apk")

    private fun alreadyDownloaded(r: Release): Long =
        apkFile(r).takeIf { it.exists() }?.length() ?: File(dir, "${apkFile(r).name}.part").length()

    /**
     * Wi-Fi faible (cedric, 31/10 : bloqué à 0 %) : le téléchargement ne renonce pas à la première coupure. Il reprend là
     * où il s'est arrêté, jusqu'à [ESSAIS_TELECHARGEMENT] fois, en patientant un peu plus à chaque fois, et passe d'une
     * source à l'autre (hébergement Firebase, puis la même version publiée sur GitHub). L'écran dit ce qui se passe.
     */
    private suspend fun telechargerAvecPatience(r: Release) {
        var essai = 0
        while (true) {
            try {
                fetchApk(r, sourcesApk(r)[essai % sourcesApk(r).size])
                return
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                essai++
                Log.w(TAG, "Téléchargement, essai $essai/$ESSAIS_TELECHARGEMENT", e)
                if (essai >= ESSAIS_TELECHARGEMENT) throw e
                _ui.value = UpdateUi.Downloading(r, withContext(Dispatchers.IO) { alreadyDownloaded(r) }, essai, raisonEnClair(e))
                delay(pauseAvantEssai(essai))
            }
        }
    }

    /** Les adresses de l'APK, dans l'ordre : l'hébergement Firebase, puis la release GitHub de la même version. */
    private fun sourcesApk(r: Release): List<URL> = listOfNotNull(apkUrl(r), runCatching { URL(urlGithub(r.versionName)) }.getOrNull())

    /** Télécharge l'APK depuis [source] en reprenant un fichier partiel, avec la progression à l'écran. */
    private suspend fun fetchApk(r: Release, source: URL = apkUrl(r)) = withContext(Dispatchers.IO) {
        val target = apkFile(r)
        if (target.exists() && target.length() == r.size) return@withContext
        target.delete()
        val part = File(dir, "${target.name}.part")
        var have = if (part.exists() && part.length() < r.size) part.length() else 0L.also { part.delete() }
        val conn = connect(source).apply { if (have > 0) setRequestProperty("Range", "bytes=$have-") }
        try {
            when (conn.responseCode) {
                206 -> Unit
                200 -> have = 0 // le serveur ne reprend pas : on recommence au début
                else -> error("HTTP ${conn.responseCode}")
            }
            FileOutputStream(part, have > 0).use { out ->
                conn.inputStream.use { input ->
                    val buf = ByteArray(64 * 1024)
                    var lastShown = 0L
                    while (true) {
                        ensureActive()
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        have += n
                        check(have <= r.size) { "Fichier plus gros qu'annoncé" }
                        // Wi-Fi faible : la progression bouge dès 64 Ko, jamais figée à 0 % tant que ça avance.
                        if (have - lastShown >= 64 * 1024 || have == r.size) {
                            lastShown = have
                            _ui.update { s -> if (s is UpdateUi.Downloading && s.release == r) UpdateUi.Downloading(r, have) else s }
                        }
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
        check(part.length() == r.size) { "Téléchargement incomplet" }
        check(part.renameTo(target)) { "Fichier impossible à enregistrer" }
    }

    /** Null si l'APK téléchargé est bien la version annoncée, intacte, de notre appli, signée par notre clé. */
    private suspend fun verified(r: Release): ApkProblem? = withContext(Dispatchers.IO) {
        val file = apkFile(r)
        if (!file.exists()) return@withContext ApkProblem.CORRUPTED
        val app = getApplication<Application>()
        val pm = app.packageManager
        val archive = archiveInfo(pm, file)
        val facts = ApkFacts(
            sha256 = sha256(file),
            size = file.length(),
            packageName = archive?.packageName,
            versionCode = archive?.let(::versionCodeOf),
            signers = signersOf(archive),
        )
        val own = pm.getPackageInfo(app.packageName, signingFlag())
        verifyApk(r, facts, app.packageName, installed, signersOf(own)).also { p ->
            if (p != null) Log.w(TAG, "APK refusé : $p ($facts)")
        }
    }

    private fun cleanup() {
        dir.listFiles()?.forEach { f ->
            val vc = Regex("""lmp-tv-(\d+)\.apk""").find(f.name)?.groupValues?.get(1)?.toLongOrNull()
            if (vc == null || vc <= installed) f.delete()
        }
    }

    private fun connect(url: URL) = (url.openConnection() as HttpURLConnection).apply {
        connectTimeout = 15_000
        readTimeout = 30_000
        instanceFollowRedirects = true
        useCaches = false
        setRequestProperty("Cache-Control", "no-cache")
    }

    companion object {
        private const val TAG = "MiseAJour"
        private const val AUTO_CHECK_DELAY_MS = 20_000L
        /** Box allumée toute la journée : nouvelle recherche toutes les 30 minutes (un petit fichier). */
        private const val RECHECK_MS = 30L * 60 * 1000
        /** Essais du téléchargement avant de renoncer (chacun reprend là où le précédent s'est arrêté). */
        const val ESSAIS_TELECHARGEMENT = 8

        /** Pause avant le nouvel essai n° [essai] : 3 s, 6 s, 9 s… jusqu'à 20 s. */
        fun pauseAvantEssai(essai: Int): Long = (3_000L * essai).coerceAtMost(20_000L)

        /** La même version publiée sur GitHub (release « tv-v0.1.N »), secours quand l'hébergement Firebase coince. */
        fun urlGithub(versionName: String) =
            "https://github.com/cedricberg-max/Little-Miss-Party-Quiz/releases/download/tv-v$versionName/little-miss-party-quiz-tv.apk"

        /** Ce qui a coupé le téléchargement, en mots simples, pour l'écran. */
        fun raisonEnClair(e: Throwable): String = when (e) {
            is java.net.SocketTimeoutException -> "le Wi-Fi ne répond plus, délai dépassé"
            is java.net.UnknownHostException -> "pas d'accès à Internet"
            is java.net.ConnectException -> "connexion impossible"
            is javax.net.ssl.SSLException -> "connexion sécurisée coupée"
            is java.io.IOException -> "connexion coupée" + (e.message?.takeIf { it.isNotBlank() }?.let { " : ${it.take(60)}" } ?: "")
            else -> e.message?.takeIf { it.isNotBlank() }?.take(80) ?: "erreur ${e.javaClass.simpleName}"
        }
        private fun mo(bytes: Long) = (bytes + 999_999) / 1_000_000

        fun problemMessage(p: ApkProblem) = when (p) {
            ApkProblem.CORRUPTED -> "Le fichier reçu est incomplet ou abîmé. Réessayez le téléchargement."
            ApkProblem.UNREADABLE -> "Le fichier reçu n'est pas une appli Android lisible. Réessayez plus tard."
            ApkProblem.WRONG_PACKAGE -> "Le fichier reçu n'est pas l'appli Little Miss Party Quiz : installation refusée."
            ApkProblem.WRONG_VERSION -> "Le fichier reçu n'est pas la version annoncée : installation refusée."
            ApkProblem.WRONG_SIGNATURE -> "Le fichier reçu n'est pas signé par notre clé : installation refusée."
        }

        fun sha256(file: File): String {
            val md = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    md.update(buf, 0, n)
                }
            }
            return md.digest().joinToString("") { "%02x".format(it) }
        }

        @Suppress("DEPRECATION")
        private fun signingFlag() =
            if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

        @Suppress("DEPRECATION")
        private fun archiveInfo(pm: PackageManager, file: File): PackageInfo? {
            val info = pm.getPackageArchiveInfo(file.path, signingFlag())
            // Certaines versions d'Android ne rendent pas les certificats d'un fichier avec le nouveau drapeau.
            if (info != null && signersOf(info).isEmpty() && Build.VERSION.SDK_INT >= 28) {
                return pm.getPackageArchiveInfo(file.path, PackageManager.GET_SIGNATURES) ?: info
            }
            return info
        }

        @Suppress("DEPRECATION")
        private fun versionCodeOf(info: PackageInfo): Long =
            if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

        @Suppress("DEPRECATION")
        fun signersOf(info: PackageInfo?): Set<String> {
            if (info == null) return emptySet()
            val certs = if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) {
                val s = info.signingInfo!!
                if (s.hasMultipleSigners()) s.apkContentsSigners else s.signingCertificateHistory
            } else {
                info.signatures
            }
            return certs.orEmpty().map { sig ->
                MessageDigest.getInstance("SHA-256").digest(sig.toByteArray()).joinToString("") { "%02x".format(it) }
            }.toSet()
        }

        /** Confie l'APK à l'installateur d'Android, qui demande confirmation à l'écran. */
        private fun commitSession(context: Context, apk: File) {
            val installer = context.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(context.packageName)
                setSize(apk.length())
            }
            val id = installer.createSession(params)
            installer.openSession(id).use { session ->
                session.openWrite("lmp-tv.apk", 0, apk.length()).use { out ->
                    apk.inputStream().use { it.copyTo(out) }
                    session.fsync(out)
                }
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
                val pending = PendingIntent.getBroadcast(
                    context, id, Intent(context, InstallReceiver::class.java).setAction(InstallReceiver.ACTION), flags,
                )
                session.commit(pending.intentSender)
            }
        }
    }
}

data class InstallResult(val status: Int, val message: String?)

/** Réponses de l'installateur d'Android, transmises à la fenêtre de mise à jour. */
object InstallEvents {
    val results = MutableSharedFlow<InstallResult>(extraBufferCapacity = 4)
}

/** Reçoit la réponse de l'installateur : écran de confirmation à afficher, ou résultat final. */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION")
            val confirm = if (Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
            } else {
                intent.getParcelableExtra(Intent.EXTRA_INTENT)
            }
            confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)?.let { runCatching { context.startActivity(it) } }
            return
        }
        InstallEvents.results.tryEmit(InstallResult(status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)))
    }

    companion object {
        const val ACTION = "com.littlemissparty.quiz.tv.INSTALL_RESULT"
    }
}

/** Après une mise à jour, l'appli se relance seule sur la TV (Android 9 de la Mi Box). */
class UpdatedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        runCatching {
            context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
