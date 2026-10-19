/**
 * Animation des tablettes qui ne dessinent pas, pendant le Pictionary : trois petits personnages caricaturaux
 * (le peintre, le détective, les crayons danseurs) se relaient avec des bulles rigolotes, et le logo
 * Little Miss Party se glisse dans chaque scène. Tout est en SVG animé par CSS (transformations seulement),
 * léger pour une tablette bon marché. Module autonome, sans Firebase.
 */

const SCENE_MS = 7000;
const BULLE_MS = 3500;

const MESSAGES = [
  ["Chut… je m'inspire !", "C'est un chat ? Une girafe ? Une baignoire ?", "Moi, je dessine avec les pieds !"],
  ["J'enquête sur ce dessin…", "Indice : ce n'est PAS un hippopotame.", "Hmm… très suspect, ce gribouillis !"],
  ["Allez {equipe}, on y croit !", "On taille nos mines et on danse !", "Trois, deux, un… gribouillez !"],
];

const LOGO = "img/logo-lmp.webp";

const yeux = (x, y, r = 9) => `
  <g class="sp-oeil" transform="translate(${x} ${y})">
    <circle r="${r}" fill="#fff" stroke="#1b1035" stroke-width="2"/>
    <circle class="sp-pupille" r="${r * 0.45}" fill="#1b1035"/>
    <rect class="sp-paupiere" x="${-r - 1}" y="${-r - 1}" width="${2 * r + 2}" height="${2 * r + 2}" rx="${r}" fill="#ffd9b8"/>
  </g>`;

const PEINTRE = `
  <g class="sp-scene" data-scene="0">
    <g class="sp-chevalet">
      <line x1="250" y1="190" x2="230" y2="262" stroke="#8b5a2b" stroke-width="7" stroke-linecap="round"/>
      <line x1="330" y1="190" x2="350" y2="262" stroke="#8b5a2b" stroke-width="7" stroke-linecap="round"/>
      <line x1="290" y1="190" x2="290" y2="258" stroke="#8b5a2b" stroke-width="6" stroke-linecap="round"/>
      <rect x="208" y="70" width="164" height="124" rx="8" fill="#2a1250" stroke="#e0b577" stroke-width="8"/>
      <circle cx="240" cy="96" r="2" fill="#fff"/><circle cx="340" cy="90" r="1.6" fill="#f0cc92"/><circle cx="350" cy="170" r="2" fill="#fff"/>
      <image href="${LOGO}" x="222" y="104" width="136" height="49" preserveAspectRatio="xMidYMid meet"/>
      <rect class="sp-voile" x="214" y="76" width="152" height="112" fill="#fffdf6"/>
      <path class="sp-tache" d="M232 175 q6 -10 12 0 q4 8 -6 9 q-10 0 -6 -9z" fill="#ff2d8a"/>
    </g>
    <g class="sp-perso sp-respire">
      <path d="M58 262 q-6 -88 62 -96 q68 8 62 96z" fill="#2b86c5" stroke="#1b1035" stroke-width="3"/>
      <path d="M95 175 l25 22 l25 -22" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
      <circle cx="120" cy="120" r="46" fill="#ffd9b8" stroke="#1b1035" stroke-width="3"/>
      ${yeux(103, 112)}${yeux(137, 112)}
      <ellipse cx="120" cy="132" rx="10" ry="8" fill="#ff8a80" stroke="#1b1035" stroke-width="2"/>
      <path class="sp-moustache" d="M92 146 q14 -10 28 -2 q14 -8 28 2 q-14 8 -28 0 q-14 8 -28 0z" fill="#5a3412"/>
      <path d="M72 96 q36 -44 88 -12 q-20 -6 -60 4z" fill="#ff2d8a" stroke="#1b1035" stroke-width="3"/>
      <circle cx="146" cy="76" r="5" fill="#ff2d8a" stroke="#1b1035" stroke-width="2"/>
      <g class="sp-bras-pinceau">
        <path d="M168 196 q30 -10 52 -40" fill="none" stroke="#2b86c5" stroke-width="16" stroke-linecap="round"/>
        <circle cx="222" cy="154" r="10" fill="#ffd9b8" stroke="#1b1035" stroke-width="2"/>
        <line x1="222" y1="154" x2="250" y2="118" stroke="#8b5a2b" stroke-width="5" stroke-linecap="round"/>
        <path d="M248 120 l10 -14 l4 4z" fill="#ff2d8a" stroke="#1b1035" stroke-width="1.5"/>
      </g>
    </g>
  </g>`;

const DETECTIVE = `
  <g class="sp-scene" data-scene="1">
    <text class="sp-question q1" x="70" y="80">?</text>
    <text class="sp-question q2" x="320" y="70">?</text>
    <text class="sp-question q3" x="200" y="50">?</text>
    <g class="sp-marche">
      <g class="sp-perso sp-sautille">
        <path d="M150 262 l-6 -24 h76 l-6 24z" fill="#5a3412"/>
        <path d="M140 244 q-4 -84 42 -92 q46 8 42 92z" fill="#e8c38a" stroke="#1b1035" stroke-width="3"/>
        <line x1="182" y1="160" x2="182" y2="240" stroke="#1b1035" stroke-width="2"/>
        <circle cx="176" cy="196" r="3" fill="#1b1035"/><circle cx="176" cy="214" r="3" fill="#1b1035"/>
        <circle cx="182" cy="112" r="40" fill="#ffd9b8" stroke="#1b1035" stroke-width="3"/>
        ${yeux(168, 108, 8)}
        <path d="M150 130 q32 16 62 0" fill="none" stroke="#1b1035" stroke-width="3" stroke-linecap="round"/>
        <path d="M134 86 h96 l-10 -10 h-76z" fill="#8b5a2b" stroke="#1b1035" stroke-width="3"/>
        <path d="M150 76 q32 -40 64 0z" fill="#8b5a2b" stroke="#1b1035" stroke-width="3"/>
        <rect x="150" y="70" width="64" height="7" fill="#ff2d8a"/>
        <g class="sp-loupe">
          <line x1="226" y1="180" x2="250" y2="140" stroke="#8b5a2b" stroke-width="8" stroke-linecap="round"/>
          <circle cx="262" cy="118" r="28" fill="rgba(200,230,255,.55)" stroke="#e0b577" stroke-width="7"/>
          <g transform="translate(262 118)">
            <circle r="14" fill="#fff" stroke="#1b1035" stroke-width="2"/>
            <circle class="sp-pupille" r="7" fill="#1b1035"/>
          </g>
          <path d="M246 102 q8 -8 18 -6" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>
        </g>
      </g>
    </g>
    <g class="sp-affiche">
      <rect x="20" y="170" width="96" height="70" rx="8" fill="#2a1250" stroke="#e0b577" stroke-width="5"/>
      <image href="${LOGO}" x="26" y="188" width="84" height="30" preserveAspectRatio="xMidYMid meet"/>
      <line x1="68" y1="240" x2="68" y2="262" stroke="#8b5a2b" stroke-width="6"/>
    </g>
  </g>`;

const crayon = (x, couleur, phase, avecLogo) => `
  <g class="sp-crayon" style="--phase:${phase}s" transform="translate(${x} 0)">
    <g class="sp-danse">
      <path d="M-22 92 h44 v128 h-44z" fill="${couleur}" stroke="#1b1035" stroke-width="3"/>
      <rect x="-22" y="72" width="44" height="22" rx="6" fill="#ff8ab8" stroke="#1b1035" stroke-width="3"/>
      <rect x="-22" y="90" width="44" height="8" fill="#c9c9d6" stroke="#1b1035" stroke-width="2"/>
      <path d="M-22 220 l22 34 l22 -34z" fill="#ffd9a0" stroke="#1b1035" stroke-width="3"/>
      <path d="M-7 243 l7 11 l7 -11z" fill="#1b1035"/>
      ${yeux(-9, 132, 7)}${yeux(9, 132, 7)}
      <path d="M-10 152 q10 10 20 0" fill="none" stroke="#1b1035" stroke-width="3" stroke-linecap="round"/>
      <g class="sp-bras g"><path d="M-22 170 q-24 -6 -30 -28" fill="none" stroke="#1b1035" stroke-width="4" stroke-linecap="round"/></g>
      <g class="sp-bras d"><path d="M22 170 q24 -6 30 -28" fill="none" stroke="#1b1035" stroke-width="4" stroke-linecap="round"/></g>
      ${avecLogo ? `<g class="sp-pancarte"><line x1="0" y1="72" x2="0" y2="44" stroke="#8b5a2b" stroke-width="5"/>
        <rect x="-56" y="4" width="112" height="44" rx="8" fill="#2a1250" stroke="#e0b577" stroke-width="4"/>
        <image href="${LOGO}" x="-50" y="8" width="100" height="36" preserveAspectRatio="xMidYMid meet"/></g>` : ""}
    </g>
  </g>`;

const CRAYONS = `
  <g class="sp-scene" data-scene="2">
    ${crayon(110, "#2b86c5", 0, false)}${crayon(200, "#ffb000", 0.25, true)}${crayon(290, "#12c957", 0.5, false)}
    <g class="sp-notes"><text x="40" y="110">♪</text><text x="350" y="90">♫</text><text x="60" y="200">♪</text></g>
  </g>`;

/**
 * Lance l'animation dans [hote]. options : { equipe } (l'équipe qui dessine, citée dans les bulles et le bandeau).
 * Rend { arreter() }, à appeler quand le tour se termine.
 */
export function animationSpectateurs(hote, { equipe = "l'équipe" } = {}) {
  hote.classList.add("spectateurs");
  hote.innerHTML = `
    <div class="sp-titre">Pictionary</div>
    <div class="sp-bulle" aria-live="polite"></div>
    <div class="sp-scene-zone">
      <svg viewBox="0 0 400 270" class="sp-svg" aria-hidden="true">
        <ellipse cx="200" cy="262" rx="190" ry="10" fill="rgba(26,11,46,.25)"/>
        ${PEINTRE}${DETECTIVE}${CRAYONS}
      </svg>
    </div>
    <div class="sp-bandeau"></div>`;
  hote.querySelector(".sp-bandeau").textContent = `L'équipe « ${equipe} » dessine : regardez la télé !`;
  const scenes = [...hote.querySelectorAll(".sp-scene")];
  const bulle = hote.querySelector(".sp-bulle");
  let scene = -1;
  let message = 0;
  const texte = (s, m) => MESSAGES[s][m % MESSAGES[s].length].replace("{equipe}", equipe);

  function montrerBulle(t) {
    bulle.classList.remove("sp-bulle-entre");
    void bulle.offsetWidth;
    bulle.textContent = t;
    bulle.classList.add("sp-bulle-entre");
  }
  function sceneSuivante() {
    scene = (scene + 1) % scenes.length;
    scenes.forEach((g, i) => g.classList.toggle("sp-active", i === scene));
    message = Math.floor(Math.random() * MESSAGES[scene].length);
    montrerBulle(texte(scene, message));
  }
  sceneSuivante();
  // Une seule horloge : deux bulles par scène, puis le personnage suivant arrive avec sa propre bulle.
  let tic = 0;
  const minuterie = setInterval(() => {
    tic += 1;
    if (tic % (SCENE_MS / BULLE_MS) === 0) sceneSuivante();
    else montrerBulle(texte(scene, ++message));
  }, BULLE_MS);

  return {
    arreter() {
      clearInterval(minuterie);
      hote.innerHTML = "";
      hote.classList.remove("spectateurs");
    },
  };
}
