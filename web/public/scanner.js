// Scanner de QR code de l'affiche (appli ouverte sans QR code, cedric 31/10) : la caméra arrière de la tablette en
// plein écran ; dès qu'elle voit le QR code de la TV, la tablette va à la partie. Lecture par BarcodeDetector (Chrome
// sur Android) ; sans lui ou sans caméra, une phrase douce dit d'utiliser l'appareil photo de la tablette.

/** Adresse de partie lue dans un QR code (même site, avec ?g=CODE), ou null pour un autre QR code. */
export function adresseDePartie(texte, ici = location) {
  try {
    const u = new URL(String(texte ?? "").trim(), ici.href);
    if (u.host !== ici.host) return null;
    return /^[A-Za-z0-9]{4,8}$/.test(u.searchParams.get("g") ?? "") ? u.href : null;
  } catch {
    return null;
  }
}

/** Ouvre le scanner par-dessus la page ; va à la partie dès qu'un QR code de la TV est lu. */
export async function ouvrirScanner() {
  const fond = document.createElement("div");
  fond.className = "scanner";
  fond.innerHTML = `
    <video class="scanner-video" playsinline muted></video>
    <div class="scanner-cadre" aria-hidden="true"></div>
    <p class="scanner-texte">Visez le QR code de la TV</p>
    <button class="scanner-fermer" type="button" aria-label="Fermer">✕</button>`;
  document.body.appendChild(fond);
  const video = fond.querySelector("video");
  const texte = fond.querySelector(".scanner-texte");
  let flux = null;
  let fini = false;
  const fermer = () => {
    fini = true;
    flux?.getTracks().forEach((t) => t.stop());
    fond.remove();
  };
  fond.querySelector(".scanner-fermer").onclick = fermer;
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
    texte.textContent = "Ouvrez l'appareil photo de la tablette et visez le QR code de la TV.";
    return;
  }
  try {
    flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  } catch {
    texte.textContent = "La caméra n'est pas autorisée. Ouvrez l'appareil photo de la tablette et visez le QR code de la TV.";
    return;
  }
  if (fini) { flux.getTracks().forEach((t) => t.stop()); return; }
  video.srcObject = flux;
  await video.play().catch(() => {});
  const lecteur = new BarcodeDetector({ formats: ["qr_code"] });
  const regarder = async () => {
    if (fini) return;
    try {
      for (const code of await lecteur.detect(video)) {
        const adresse = adresseDePartie(code.rawValue);
        if (adresse) { fermer(); location.href = adresse; return; }
        texte.textContent = "Ce n'est pas le QR code de la TV : visez celui de l'écran du jeu.";
      }
    } catch { /* image pas encore prête : on réessaie */ }
    setTimeout(regarder, 250);
  };
  regarder();
}
