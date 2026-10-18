#!/usr/bin/env bash
# Lancé par le workflow « Tests Android » une fois l'émulateur Android TV démarré.
set -uo pipefail

OUT=android-test-output
CAPTURES=/data/local/tmp/lmp-captures
PKG=com.littlemissparty.quiz.tv
mkdir -p "$OUT/captures"

{
  echo "Android $(adb shell getprop ro.build.version.release) (API $(adb shell getprop ro.build.version.sdk))"
  echo "Modèle : $(adb shell getprop ro.product.model)"
  echo "Écran : $(adb shell wm size | tr -d '\r')"
  adb shell pm list features | grep -E 'leanback|television' || echo "Pas de fonction Android TV déclarée"
} | tee "$OUT/appareil.txt"

adb logcat -c
adb logcat -v time > "$OUT/logcat.txt" 2>&1 &
LOGCAT=$!

# Le DNS est coupé : les vrais serveurs Firebase doivent être injoignables.
if adb shell ping -c 1 -W 3 firebaseio.com 2>&1 | grep -q "PING .*([0-9]"; then
  echo "ERREUR : l'émulateur joint Internet, arrêt pour ne pas toucher la vraie base."
  exit 1
fi

# Marqueur que les tests vérifient avant de commencer : il n'existe que dans l'émulateur Firebase.
curl -sf -X PUT -H "Authorization: Bearer owner" -d '{"hostUid":"emulateur-ci"}' \
  "http://127.0.0.1:9000/games/CIEMU.json?ns=little-miss-party-quiz-default-rtdb" > /dev/null || {
  echo "ERREUR : émulateur Firebase injoignable"; exit 1; }

adb shell rm -rf "$CAPTURES"
adb shell mkdir -p "$CAPTURES"

./gradlew :tv:connectedDebugAndroidTest --stacktrace
STATUS=$?

adb pull "$CAPTURES/." "$OUT/captures/" > /dev/null || true

# L'APK publié lui-même (celui de la box) : installation et démarrage sans accès à la vraie base.
echo "== APK publié : installation et démarrage hors connexion =="
APK=tv/build/outputs/apk/release/tv-release.apk
SMOKE="$OUT/apk-publie.txt"
if adb install -r "$APK" > "$SMOKE" 2>&1; then
  adb logcat -c
  adb shell am start -W -n "$PKG/.MainActivity" >> "$SMOKE" 2>&1
  sleep 20
  adb exec-out screencap -p > "$OUT/captures/apk-publie-hors-connexion.png"
  PID=$(adb shell pidof "$PKG" | tr -d '\r')
  if [ -z "$PID" ] || adb logcat -d | grep -A5 "FATAL EXCEPTION" | grep -q "$PKG"; then
    echo "ÉCHEC : l'APK publié s'est arrêté au démarrage" | tee -a "$SMOKE"
    adb logcat -d | grep -A30 "FATAL EXCEPTION" >> "$SMOKE" || true
    STATUS=1
  else
    echo "OK : l'APK publié démarre et reste ouvert sans réseau" | tee -a "$SMOKE"
  fi
else
  echo "ÉCHEC : installation de l'APK publié impossible" | tee -a "$SMOKE"
  STATUS=1
fi

kill "$LOGCAT" 2>/dev/null || true

# Diagnostic lisible directement dans le journal du workflow.
echo "== Échecs détaillés =="
python3 - <<'PY'
import glob, xml.etree.ElementTree as ET
for f in glob.glob("tv/build/outputs/androidTest-results/**/TEST-*.xml", recursive=True):
    for tc in ET.parse(f).getroot().iter("testcase"):
        e = tc.find("failure")
        if e is not None:
            print("---", tc.get("classname").split(".")[-1], tc.get("name"))
            print("\n".join((e.text or "").splitlines()[:25]))
PY
echo "== Journal Android (extrait) =="
grep -E "TestsTV|Partie|RepoOperation|PersistentConnection|Connection|WebSocket|FirebaseAuth|AndroidRuntime|System.err" "$OUT/logcat.txt" | grep -v "^--------" | tail -n 400
exit $STATUS
