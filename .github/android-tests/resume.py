"""Résumé lisible des tests Android pour la page du workflow GitHub."""
import glob
import os
import sys
import xml.etree.ElementTree as ET

resultats, sortie = sys.argv[1], sys.argv[2]
cas = []
for f in sorted(glob.glob(os.path.join(resultats, "**", "TEST-*.xml"), recursive=True)):
    for tc in ET.parse(f).getroot().iter("testcase"):
        echec = tc.find("failure")
        if echec is None:
            echec = tc.find("error")
        ignore = tc.find("skipped") is not None
        etat = "⏭️ ignoré" if ignore else ("❌ échec" if echec is not None else "✅ réussi")
        detail = ""
        if echec is not None:
            texte = (echec.get("message") or echec.text or "").strip()
            detail = texte.splitlines()[0][:200] if texte else ""
        cas.append((tc.get("classname", "").split(".")[-1], tc.get("name"), etat, float(tc.get("time", 0)), detail))

print("## Tests Android TV")
appareil = os.path.join(sortie, "appareil.txt")
if os.path.exists(appareil):
    print("\n" + open(appareil).read().strip().replace("\n", "  \n"))
if not cas:
    print("\n❌ Aucun résultat de test : les tests n'ont pas pu s'exécuter (voir les journaux).")
else:
    ok = sum(1 for c in cas if c[2].startswith("✅"))
    ko = sum(1 for c in cas if c[2].startswith("❌"))
    print(f"\n**{ok} réussis, {ko} en échec, {len(cas)} au total**\n")
    print("| Scénario | Test | Résultat | Durée | Détail |")
    print("|---|---|---|---|---|")
    for classe, nom, etat, duree, detail in cas:
        print(f"| {classe} | {nom} | {etat} | {duree:.0f} s | {detail.replace('|', '/')} |")
smoke = os.path.join(sortie, "apk-publie.txt")
if os.path.exists(smoke):
    lignes = [l for l in open(smoke).read().splitlines() if l.startswith(("OK", "ÉCHEC"))]
    print("\n**APK publié :** " + (lignes[-1] if lignes else "résultat inconnu"))
print("\nCaptures d'écran et journaux : artefact « tests-android-tv » en bas de cette page.")
