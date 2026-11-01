package com.littlemissparty.quiz.tv

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings

/** Les deux réglages Android dont la mise à jour a besoin, demandés dès le lancement (une seule fois par box). */
enum class Reglage {
    /** « Sources inconnues » : l'appli a le droit d'installer ses propres mises à jour. */
    INSTALLER,

    /**
     * « Afficher par-dessus les autres applis » : depuis Android 10, c'est le seul moyen pour une appli de se rouvrir
     * toute seule juste après sa mise à jour (box de cedric en Android 14, Mi Box en Android 11 ; seules les box en Android 9 n'en ont pas
     * besoin). Facultatif : si la box n'a pas ce réglage, on ne le redemande pas.
     */
    RELANCER,
}

/**
 * Cedric, 1/11 au soir : la permission d'installer n'était demandée qu'au tout dernier moment, et le réglage Android
 * ouvert à part renvoyait au gestionnaire de fichiers au lieu de revenir dans l'appli. Désormais :
 * - les réglages manquants sont proposés dès le lancement, à l'accueil ;
 * - le réglage s'ouvre DANS la tâche de l'appli (sans « nouvelle tâche ») : Retour revient sur l'appli ;
 * - une installation en attente reprend toute seule au retour.
 */
object ReglagesMiseAJour {
    private const val PREFS = "reglages-mise-a-jour"
    private const val CLE_RELANCE_ESSAYEE = "relance-essayee"

    /** Faux seulement dans les tests sur émulateur : la fenêtre cacherait l'accueil des captures du tour des écrans. */
    @Volatile
    var proposerAuLancement = true

    /** Android 10 et plus : une appli ne peut plus se rouvrir seule depuis l'arrière-plan sans ce réglage. */
    fun relanceDemandeLeReglage(sdk: Int): Boolean = sdk >= Build.VERSION_CODES.Q

    /**
     * Ce qu'il reste à régler. [relanceEssayee] : le réglage « relancer » a déjà été ouvert une fois sans être accordé
     * (box qui ne le propose pas vraiment) : on ne le redemande plus.
     */
    fun manquants(peutInstaller: Boolean, sdk: Int, peutSAfficher: Boolean, relanceEssayee: Boolean): List<Reglage> = buildList {
        if (!peutInstaller) add(Reglage.INSTALLER)
        if (relanceDemandeLeReglage(sdk) && !peutSAfficher && !relanceEssayee) add(Reglage.RELANCER)
    }

    fun manquants(ctx: Context): List<Reglage> = manquants(
        peutInstaller = ctx.packageManager.canRequestPackageInstalls(),
        sdk = Build.VERSION.SDK_INT,
        peutSAfficher = Settings.canDrawOverlays(ctx),
        relanceEssayee = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(CLE_RELANCE_ESSAYEE, false),
    )

    /** L'appli se rouvrira-t-elle seule après sa mise à jour sur cette box ? (sinon : son icône, à la main). */
    fun seRouvreSeule(sdk: Int, peutSAfficher: Boolean): Boolean = !relanceDemandeLeReglage(sdk) || peutSAfficher

    fun seRouvreSeule(ctx: Context): Boolean = seRouvreSeule(Build.VERSION.SDK_INT, Settings.canDrawOverlays(ctx))

    fun intention(ctx: Context, r: Reglage): Intent = Intent(
        when (r) {
            Reglage.INSTALLER -> Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES
            Reglage.RELANCER -> Settings.ACTION_MANAGE_OVERLAY_PERMISSION
        },
        Uri.parse("package:${ctx.packageName}"),
    )

    /**
     * Ouvre le réglage depuis l'écran de l'appli, sans FLAG_ACTIVITY_NEW_TASK : il s'empile sur l'appli, et Retour
     * revient dessus (plus sur le gestionnaire de fichiers). Faux si la box n'a pas cet écran.
     */
    fun ouvrir(activite: Activity, r: Reglage): Boolean {
        if (r == Reglage.RELANCER) {
            activite.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(CLE_RELANCE_ESSAYEE, true).apply()
        }
        return runCatching { activite.startActivity(intention(activite, r)) }.isSuccess
    }
}
