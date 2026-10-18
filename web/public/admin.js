import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithCredential, signOut, onAuthStateChanged, connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
  getDatabase, ref, get, set, serverTimestamp, connectDatabaseEmulator,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-database.js";
import { passwordHash, newSalt, MIN_PASSWORD_LENGTH } from "./secret.js";

// Administration de Sarah et cedric (compte Google). Les droits sont vérifiés par les règles Firebase :
// un compte qui n'est pas dans la liste des administrateurs ne peut rien enregistrer.

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// Tests automatiques uniquement : émulateur Firebase et compte Google simulé, depuis l'ordinateur de test.
const emulator = params.has("emu") && ["localhost", "127.0.0.1"].includes(location.hostname);

const config = await (await fetch("firebase-config.json", { cache: "no-store" })).json();
const app = initializeApp(config);
const auth = getAuth(app);
const db = getDatabase(app);
if (emulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectDatabaseEmulator(db, "127.0.0.1", 9000);
}

function status(id, text, ok = false) {
  $(id).textContent = text;
  $(id).classList.toggle("ok", ok);
}

$("login").onclick = async () => {
  status("login-status", "");
  try {
    if (emulator) {
      const email = params.get("as") ?? "admin@lmp.test";
      await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true })));
    } else {
      await signInWithPopup(auth, new GoogleAuthProvider());
    }
  } catch (e) {
    console.error(e);
    status("login-status", "Connexion Google impossible. Réessayez.");
  }
};
$("logout").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  const google = user && !user.isAnonymous;
  $("screen-login").hidden = !!google;
  $("screen-settings").hidden = !google;
  $("logout").hidden = !google;
  $("who").textContent = google ? user.email : "";
  if (google) await showLastChange();
});

async function showLastChange() {
  const at = (await get(ref(db, "settings/regie/updatedAt"))).val();
  $("last-change").textContent = at
    ? `Dernière modification : ${new Date(at).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}`
    : "Aucun mot de passe enregistré pour l'instant : les animatrices utilisent le code affiché sur la TV.";
}

$("password-form").onsubmit = async (e) => {
  e.preventDefault();
  const pw = $("pw1").value;
  if (pw.length < MIN_PASSWORD_LENGTH) return status("save-status", `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`);
  if (pw !== $("pw2").value) return status("save-status", "Les deux mots de passe ne sont pas identiques.");
  $("save").disabled = true;
  status("save-status", "");
  try {
    const salt = newSalt();
    await set(ref(db, "settings/regie"), {
      salt, hash: await passwordHash(salt, pw), updatedAt: serverTimestamp(), updatedBy: auth.currentUser.email,
    });
    $("pw1").value = "";
    $("pw2").value = "";
    status("save-status", "Mot de passe enregistré. Il est valable dès maintenant.", true);
    await showLastChange();
  } catch (err) {
    console.error(err);
    status("save-status", "Enregistrement refusé : ce compte Google n'a pas les droits d'administration.");
  } finally {
    $("save").disabled = false;
  }
};
