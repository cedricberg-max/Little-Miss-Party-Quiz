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

adb logcat -G 16M || true
adb logcat -c
# Seulement les journaux utiles : sinon Android en supprime une partie.
adb logcat -v time TestsTV:V Partie:V TestRunner:V AndroidRuntime:E System.err:W FirebaseAuth:D \
  PersistentConnection:D Connection:D RepoOperation:D Persistence:D '*:S' > "$OUT/logcat.txt" 2>&1 &
LOGCAT=$!

# Le DNS est coupé : les vrais serveurs Firebase doivent être injoignables.
if adb shell ping -c 1 -W 3 firebaseio.com 2>&1 | grep -q "PING .*([0-9]"; then
  echo "ERREUR : l'émulateur joint Internet, arrêt pour ne pas toucher la vraie base."
  exit 1
fi

# L'émulateur Firebase annonce son adresse comme 127.0.0.1 : le SDK s'y reconnecte après une coupure.
# Dans Android, 127.0.0.1 est l'appareil lui-même ; on renvoie ces ports vers le runner.
adb reverse tcp:9000 tcp:9000
adb reverse tcp:9099 tcp:9099

# Marqueur que les tests vérifient avant de commencer : il n'existe que dans l'émulateur Firebase.
curl -sf -X PUT -H "Authorization: Bearer owner" -d '{"hostUid":"emulateur-ci"}' \
  "http://127.0.0.1:9000/games/CIEMU.json?ns=little-miss-party-quiz-default-rtdb" > /dev/null || {
  echo "ERREUR : émulateur Firebase injoignable"; exit 1; }

adb shell rm -rf "$CAPTURES"
adb shell mkdir -p "$CAPTURES"

# Décor des tests (gs par défaut) et, au besoin, seulement quelques classes : relance à la main pour des captures.
ARGS=(-Pandroid.testInstrumentationRunnerArguments.design="${DESIGN_TESTS:-gs}")
if [ -n "${CLASSES_TESTS:-}" ]; then
  ARGS+=(-Pandroid.testInstrumentationRunnerArguments.class="$(echo "$CLASSES_TESTS" | tr -d ' ' | sed 's/\([^,]*\)/com.littlemissparty.quiz.tv.test.\1/g')")
fi
echo "Décor des tests : ${DESIGN_TESTS:-gs} ; classes : ${CLASSES_TESTS:-toutes}"
./gradlew :tv:connectedDebugAndroidTest "${ARGS[@]}" --stacktrace
STATUS=$?

adb pull "$CAPTURES/." "$OUT/captures/" > /dev/null || true

# L'APK publié lui-même (celui de la box) : installation et démarrage sans accès à la vraie base.
echo "== APK publié : installation et démarrage hors connexion =="
APK=tv/build/outputs/apk/release/tv-release.apk
SMOKE="$OUT/apk-publie.txt"
if adb install -r "$APK" > "$SMOKE" 2>&1; then
  adb shell am start -W -n "$PKG/.MainActivity" >> "$SMOKE" 2>&1
  sleep 20
  adb exec-out screencap -p > "$OUT/captures/apk-publie-hors-connexion.png"
  PID=$(adb shell pidof "$PKG" | tr -d '\r')
  if [ -z "$PID" ] || adb logcat -d -t 2000 | grep -A5 "FATAL EXCEPTION" | grep -q "$PKG"; then
    echo "ÉCHEC : l'APK publié s'est arrêté au démarrage" | tee -a "$SMOKE"
    adb logcat -d -t 2000 | grep -A30 "FATAL EXCEPTION" >> "$SMOKE" || true
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
echo "== Journal des tests (déroulé et plans d'écran) =="
grep "/TestsTV\|/TestRunner\|Opening a connection\|Realtime connection failed\|closing realtime\|Got control message\|interrupt\|Scheduling connection\|Sending data: {t=d, d={a=m" "$OUT/logcat.txt" | grep -v "TestRunner.*\sat \|TestRunner.*\.\.\. [0-9]* more" | cut -c1-400 || true
echo "== Journal Android (extrait) =="
grep -v "^--------\|/Persistence" "$OUT/logcat.txt" | cut -c1-300 | tail -n 600
exit $STATUS
