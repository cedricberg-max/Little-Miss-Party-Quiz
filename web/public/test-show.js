// Prestation de TEST « ANNIVERSAIRE TEST – Léa, 9 ans » : un vrai contenu de la bibliothèque (pas un quiz
// codé dans l'APK), ajouté en un clic depuis Paramètres pour essayer administration, régie et Mi Box ensemble.
// Clés fixes : un second clic ne crée pas de doublon et ne remplace jamais rien.

export const TEST_ID = "test-lea-9-ans";

export const TEST_QUIZ = {
  "title": "TEST – Quiz de Léa (9 ans)",
  "theme": "Culture générale (test)",
  "ageMin": 9,
  "ageMax": 9,
  "source": "saisie",
  "questions": [
    {
      "text": "Quelle est la capitale de la France ?",
      "choices": [
        "Paris",
        "Lyon",
        "Marseille",
        "Bordeaux"
      ],
      "correct": 0,
      "duration": 20,
      "double": false,
      "status": "validee"
    },
    {
      "text": "Combien de pattes a une araignée ?",
      "choices": [
        "6",
        "8",
        "10",
        "4"
      ],
      "correct": 1,
      "duration": 20,
      "double": false,
      "status": "validee"
    },
    {
      "text": "La baleine est un mammifère.",
      "choices": [
        "Vrai",
        "Faux"
      ],
      "correct": 0,
      "duration": 15,
      "double": false,
      "status": "validee"
    },
    {
      "text": "Quelle planète est surnommée la planète rouge ?",
      "choices": [
        "Vénus",
        "Jupiter",
        "Mars",
        "Saturne"
      ],
      "correct": 2,
      "duration": 20,
      "double": false,
      "status": "validee"
    },
    {
      "text": "Combien font 7 × 8 ?",
      "choices": [
        "54",
        "56",
        "63",
        "48"
      ],
      "correct": 1,
      "duration": 20,
      "double": false,
      "status": "validee"
    },
    {
      "text": "Dans quel dessin animé trouve-t-on Elsa et Anna ?",
      "choices": [
        "Vaiana",
        "Raiponce",
        "La Reine des neiges",
        "Encanto"
      ],
      "correct": 2,
      "duration": 20,
      "double": false,
      "status": "validee"
    },
    {
      "text": "Le Soleil tourne autour de la Terre.",
      "choices": [
        "Vrai",
        "Faux"
      ],
      "correct": 1,
      "duration": 15,
      "double": false,
      "status": "validee"
    },
    {
      "text": "Quel est le plus gros animal du monde ?",
      "choices": [
        "L'éléphant",
        "La girafe",
        "La baleine bleue",
        "Le requin blanc"
      ],
      "correct": 2,
      "duration": 20,
      "double": false,
      "status": "validee"
    },
    {
      "text": "Combien de couleurs a un arc-en-ciel ?",
      "choices": [
        "5",
        "6",
        "7",
        "8"
      ],
      "correct": 2,
      "duration": 20,
      "double": false,
      "status": "validee"
    },
    {
      "text": "Question finale, points ×2 : quel est le plus grand océan du monde ?",
      "choices": [
        "Atlantique",
        "Indien",
        "Arctique",
        "Pacifique"
      ],
      "correct": 3,
      "duration": 25,
      "double": true,
      "status": "validee"
    }
  ]
};

export const TEST_SHOW = {
  "childName": "Léa",
  "age": 9,
  "date": "2026-10-25",
  "status": "publiee",
  "title": "ANNIVERSAIRE TEST – Léa, 9 ans",
  "profile": "MOYENS",
  "durationMin": 20,
  "themes": "Test de synchronisation",
  "notes": "Prestation de TEST : elle sert à vérifier l'administration, la régie et la Mi Box. Elle peut être archivée sans risque.",
  "rounds": [
    {
      "type": "quiz",
      "quizId": "test-lea-9-ans"
    }
  ],
  "origin": "test"
};

// ---------- Prestation de test « tous les jeux » ----------
// Une seconde prestation, à côté de la première (jamais modifiée) : un peu de chaque jeu, dans l'ordre d'une
// vraie fête, pour tout voir sur la TV en une vingtaine de minutes. Les photos du Zoom mystère et de
// l'Image floue sont dessinées dans le navigateur au moment de l'ajout (émoji sur un fond coloré).

export const FULL_ID = "test-lea-tous-les-jeux";
export const FULL_TITLE = "ANNIVERSAIRE TEST – Léa, 9 ans · tous les jeux";

/** Clés fixes des contenus de la bibliothèque : un second clic ne crée rien en double. */
export const FULL_KEYS = {
  quiz: `${FULL_ID}-quiz`, express: `${FULL_ID}-vrai-faux`, zoom: `${FULL_ID}-zoom`, flou: `${FULL_ID}-flou`,
  mimes: `${FULL_ID}-mimes`, playlist: `${FULL_ID}-comptines`, images: `${FULL_ID}-images`,
};

const v = (text, choices, correct, extra = {}) => ({ text, choices, correct, double: false, status: "validee", ...extra });

/** Photos à dessiner : l'émoji, deux couleurs de fond, et la question qui l'accompagne. */
export const FULL_PHOTOS = {
  zoom: [
    { emoji: "🦁", colors: ["#FFB347", "#FF6F61"], q: v("Quel animal se cache sur la photo ?", ["Le tigre", "Le lion", "Le chat", "Le renard"], 1) },
    { emoji: "🚀", colors: ["#2B86C5", "#784BA0"], q: v("Qu'est-ce qui se cache sur la photo ?", ["Un avion", "Un bateau", "Une fusée", "Un train"], 2) },
  ],
  flou: [
    { emoji: "🍕", colors: ["#FFE61F", "#FF5A1F"], q: v("Qu'est-ce qui se cache sous le flou ?", ["Une pizza", "Une crêpe"], 0) },
    { emoji: "🐘", colors: ["#06D6A0", "#118AB2"], q: v("Qu'est-ce qui se cache sous le flou ?", ["Un éléphant", "Une baleine"], 0) },
  ],
};

/** Quiz en images des petits : chaque réponse est une photo dessinée (émoji sur un fond coloré). */
export const FULL_CHOICE_PHOTOS = [
  {
    text: "Quel animal court le plus vite ?", correct: 0,
    choices: [
      { word: "Guépard", emoji: "🐆", colors: ["#FFE61F", "#FF9F1C"] }, { word: "Baleine", emoji: "🐳", colors: ["#4CC9F0", "#4361EE"] },
      { word: "Escargot", emoji: "🐌", colors: ["#9EF01A", "#38B000"] }, { word: "Vache", emoji: "🐄", colors: ["#FFB3C6", "#FF5D8F"] },
    ],
  },
  {
    text: "Lequel est un fruit ?", correct: 2,
    choices: [
      { word: "Voiture", emoji: "🚗", colors: ["#F94144", "#F3722C"] }, { word: "Ballon", emoji: "🎈", colors: ["#B5179E", "#7209B7"] },
      { word: "Pomme", emoji: "🍎", colors: ["#CAFFBF", "#9BF6FF"] }, { word: "Chaussure", emoji: "👟", colors: ["#FDFFB6", "#FFD6A5"] },
    ],
  },
];

/** Quiz en images, une fois les photos dessinées et rangées ([ids] : une liste d'identifiants par question). */
export function imageQuiz(ids) {
  return {
    title: "TEST – Quiz en images des petits", theme: "Réponses en images (test)", ageMin: 5, ageMax: 6, source: "saisie",
    questions: FULL_CHOICE_PHOTOS.map((p, i) => ({
      ...v(p.text, p.choices.map((c) => c.word), p.correct, { duration: 25 }),
      choiceImages: Object.fromEntries(ids[i].map((id, k) => [String(k), id])),
    })),
  };
}

export const FULL_QUIZZES = {
  [FULL_KEYS.quiz]: {
    title: "TEST – Quiz illustré de Léa", theme: "Culture générale (test)", ageMin: 9, ageMax: 9, source: "saisie",
    questions: [
      v("Quel animal fait « miaou » ?", ["Le chien", "Le chat", "La vache", "Le canard"], 1, { image: "🐱", duration: 20 }),
      v("Quelle planète est surnommée la planète rouge ?", ["Vénus", "Jupiter", "Mars", "Saturne"], 2, { image: "🔴", duration: 20 }),
      v("Dans quel pays se trouve la tour Eiffel ?", ["En Italie", "En Espagne", "En France", "En Belgique"], 2, { image: "🗼", duration: 20 }),
      { text: "Le Juste Chiffre : combien de bougies sur le gâteau de Léa cette année ?", kind: "number", correct: 9, duration: 20, double: false, status: "validee" },
      { text: "Le Juste Chiffre : combien de jours y a-t-il dans une année ?", kind: "number", correct: 365, duration: 25, double: false, status: "validee" },
    ],
  },
  [FULL_KEYS.express]: {
    title: "TEST – Vrai ou Faux de Léa", theme: "Vrai ou Faux (test)", ageMin: 9, ageMax: 9, source: "saisie",
    questions: [
      v("La baleine est un mammifère.", ["Vrai", "Faux"], 0),
      v("Le Soleil tourne autour de la Terre.", ["Vrai", "Faux"], 1),
      v("Une araignée a 8 pattes.", ["Vrai", "Faux"], 0),
      v("Les poissons respirent hors de l'eau.", ["Vrai", "Faux"], 1),
      v("Le chocolat est fait avec du cacao.", ["Vrai", "Faux"], 0),
    ],
  },
};

export const FULL_MIMES = {
  title: "TEST – Mimes de Léa", duration: 45,
  cards: [
    { word: "Chat", image: "🐱" }, { word: "Pompier", image: "👨‍🚒" }, { word: "Football", image: "⚽" },
    { word: "Dormir", image: "😴" }, { word: "Guitare", image: "🎸" }, { word: "Manger une glace", image: "🍦" },
  ],
};

/**
 * Blind test de la prestation de test : comptines traditionnelles du domaine public, jouées par le petit
 * synthétiseur de l'administration (aucun fichier ni aucun droit nécessaire). Notes « note:temps ».
 */
export const FULL_TUNES = [
  { title: "Frère Jacques", melody: "C4:1 D4:1 E4:1 C4:1 C4:1 D4:1 E4:1 C4:1 E4:1 F4:1 G4:2 E4:1 F4:1 G4:2 G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:1 C4:1 G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4:1 C4:1 C4:1 G3:1 C4:2 C4:1 G3:1 C4:2" },
  { title: "Au clair de la lune", melody: "C4:1 C4:1 C4:1 D4:1 E4:2 D4:2 C4:1 E4:1 D4:1 D4:1 C4:4 C4:1 C4:1 C4:1 D4:1 E4:2 D4:2 C4:1 E4:1 D4:1 D4:1 C4:4 D4:1 D4:1 D4:1 D4:1 A3:2 A3:2 D4:1 C4:1 B3:1 A3:1 G3:4" },
  { title: "Ah ! vous dirai-je, maman", artist: "Mozart", melody: "C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2" },
  { title: "Joyeux anniversaire", melody: "G4:0.75 G4:0.25 A4:1 G4:1 C5:1 B4:2 G4:0.75 G4:0.25 A4:1 G4:1 D5:1 C5:2 G4:0.75 G4:0.25 G5:1 E5:1 C5:1 B4:1 A4:2 F5:0.75 F5:0.25 E5:1 C5:1 D5:1 C5:3" },
];
/** Durée des extraits de comptines (secondes). */
export const FULL_TUNE_SEC = 20;

/** Playlist de comptines, une fois les extraits fabriqués ([ids] : identifiant de chaque extrait, dans l'ordre). */
export function tunePlaylist(ids) {
  return {
    title: "TEST – Comptines",
    duration: FULL_TUNE_SEC,
    tracks: FULL_TUNES.map((t, i) => ({ title: t.title, audioId: ids[i], ...(t.artist ? { artist: t.artist } : {}), rights: "Domaine public" })),
  };
}

/** Jeux les plus récents de la prestation de test, ajoutés aussi à une prestation de test plus ancienne. */
export const FULL_NEW_ROUNDS = [
  { type: "disparu", count: 2 },
  { type: "blind", playlistId: FULL_KEYS.playlist },
  { type: "musical", playlistId: FULL_KEYS.playlist },
  { type: "statues", duration: 60 },
  { type: "pictionary", duration: 90 },
  { type: "quiz", quizId: FULL_KEYS.images },
  // Jeu final : toujours en dernier.
  { type: "coffres" },
];

export const FULL_SHOW = {
  childName: "Léa", age: 9, date: "2026-10-25", status: "publiee", title: FULL_TITLE, profile: "MOYENS", durationMin: 25,
  themes: "Tous les jeux (test)",
  notes: "Prestation de TEST : un peu de chaque jeu (quiz illustré, Juste Chiffre, Vrai ou Faux express, Mimes, Zoom mystère, Chante le mot !, Image floue, Qui suis-je ?, Qui a disparu ?, Blind test, Quiz musical, Statues musicales, Pictionary, quiz en images des petits, Portes mystères pour finir ; les 3 dernières questions du quiz comptent double (Super Finale)). Elle peut être archivée sans risque.",
  rounds: [
    // Super Finale : les 3 dernières questions de ce quiz comptent double (un réglage du quiz, pas un jeu).
    { type: "quiz", quizId: FULL_KEYS.quiz, finale: 3 },
    { type: "express", quizId: FULL_KEYS.express },
    { type: "mimes", deckId: FULL_KEYS.mimes },
    { type: "zoom", quizId: FULL_KEYS.zoom },
    { type: "chante", count: 3 },
    { type: "flou", quizId: FULL_KEYS.flou },
    { type: "quisuis", count: 3 },
    ...FULL_NEW_ROUNDS,
  ],
  origin: "test",
};

/** Quiz des photos, une fois les photos dessinées et rangées ([ids] : identifiant de chaque photo, dans l'ordre). */
export function photoQuiz(kind, ids) {
  const title = kind === "zoom" ? "TEST – Photos du Zoom mystère" : "TEST – Photos de l'Image floue";
  return {
    title, theme: "Photos (test)", ageMin: 9, ageMax: 9, source: "saisie",
    questions: FULL_PHOTOS[kind].map((p, i) => ({ ...p.q, imageId: ids[i], duration: 20 })),
  };
}

/** Dessine une photo de test : dégradé, quelques bulles, et l'émoji en très grand, en JPEG léger. */
export function drawPhoto({ emoji, colors }, document = globalThis.document) {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 640, 480);
  g.addColorStop(0, colors[0]);
  g.addColorStop(1, colors[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 640, 480);
  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  [[90, 80, 60], [560, 110, 45], [520, 400, 80], [120, 410, 40]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); });
  // Couleur pleine : sans elle, l'émoji prendrait la transparence des bulles.
  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "300px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";
  ctx.fillText(emoji, 320, 260);
  return canvas.toDataURL("image/jpeg", 0.8);
}
