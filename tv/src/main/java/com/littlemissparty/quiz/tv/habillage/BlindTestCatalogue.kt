package com.littlemissparty.quiz.tv.habillage

/**
 * Le paquet « Blind test libre de droits » livré avec l'appli : des mélodies du domaine public
 * (comptines traditionnelles, compositeurs morts depuis plus de 70 ans) arrangées et enregistrées par le
 * studio de Little Miss Party (`tools/habillage/blindtest.py`). Aucun droit à déclarer, aucune connexion
 * nécessaire : le blind test marche toujours, même sans MP3 importé.
 *
 * [source] est ce que le moteur sonore sait jouer (« res:lmp_bt_… ») ; [reponse] est ce qu'on accepte et
 * qu'on affiche à la révélation ; [qui] précise l'auteur ou l'origine.
 */
data class ExtraitIntegre(val id: String, val reponse: String, val qui: String, val pourLesPetits: Boolean) {
    val source: String get() = "res:lmp_bt_$id"
}

object BlindTestCatalogue {
    val extraits = listOf(
        ExtraitIntegre("frere_jacques", "Frère Jacques", "Comptine traditionnelle", true),
        ExtraitIntegre("au_clair_de_la_lune", "Au clair de la lune", "Comptine traditionnelle", true),
        ExtraitIntegre("ah_vous_dirai_je_maman", "Ah ! vous dirai-je, maman", "Comptine traditionnelle", true),
        ExtraitIntegre("joyeux_anniversaire", "Joyeux anniversaire", "Mildred et Patty Hill", true),
        ExtraitIntegre("vive_le_vent", "Vive le vent", "James Lord Pierpont", true),
        ExtraitIntegre("la_cucaracha", "La cucaracha", "Chanson traditionnelle mexicaine", true),
        ExtraitIntegre("lettre_a_elise", "La Lettre à Élise", "Ludwig van Beethoven", false),
        ExtraitIntegre("hymne_a_la_joie", "L'Hymne à la joie", "Ludwig van Beethoven", false),
        ExtraitIntegre("marche_turque", "La Marche turque", "Wolfgang Amadeus Mozart", false),
        ExtraitIntegre("antre_du_roi_de_la_montagne", "Dans l'antre du roi de la montagne", "Edvard Grieg", false),
        ExtraitIntegre("le_printemps_vivaldi", "Le Printemps", "Antonio Vivaldi", false),
        ExtraitIntegre("french_cancan", "Le French cancan", "Jacques Offenbach", false),
    )

    fun parId(id: String) = extraits.find { it.id == id }
}
