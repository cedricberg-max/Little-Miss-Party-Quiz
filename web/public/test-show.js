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
