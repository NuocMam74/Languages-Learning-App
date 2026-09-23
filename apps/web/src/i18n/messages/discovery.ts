/** Visite guidée de l'écran du parcours, en bulles (contrats phase23 §3 et phase26 §8). */
export const fr = {
  "discovery.step": "{i} sur {n}",
  "discovery.next": "Suivant",
  "discovery.done": "C'est parti",
  "discovery.skip": "Passer la visite",
  "discovery.back": "Précédent",
  "discovery.replay": "Revoir la visite",
  "discovery.replay.hint": "Des bulles posées sur l'écran du parcours, pour savoir où tout se trouve.",

  "tour.welcome.title": "Bienvenue sur ton parcours",
  "tour.welcome.body": "Voici l'écran où tu reviendras chaque jour. Quelques bulles pour te montrer où tout se trouve : avance à ton rythme, ou passe la visite.",
  "tour.help.title": "Revoir cette visite",
  "tour.help.body": "Un doute sur un bouton ? Touche le « ? » à tout moment : la visite reprend depuis le début.",
  "tour.help.button": "Revoir la visite guidée",

  "discovery.path.title": "Ton parcours remonte le fleuve",
  "discovery.path.body": "Chaque étape est un niveau : une poignée de mots, vingt exercices, une note sur 20. Les niveaux s'ouvrent quand le précédent est maîtrisé — jamais parce que tu as payé ou attendu.",

  "discovery.session.title": "Une séance par jour, à ta mesure",
  "discovery.session.body": "Tu as choisi {n} minutes. La séance tient dans ce temps-là : le niveau du jour, plus les mots que ta mémoire est sur le point de lâcher.",

  "discovery.review.title": "Rien de ce que tu vois n'est perdu",
  "discovery.review.body": "Chaque mot rencontré entre dans ta bibliothèque et revient juste avant que tu l'oublies. L'onglet Réviser garde tout : les mots, les dialogues, les fiches conseils, tes notes.",

  "discovery.memo.title": "Une fiche à emporter à chaque niveau",
  "discovery.memo.body": "À la fin d'un niveau, un pense-bête s'affiche : les mots, les règles, les pièges du Sud. Il t'attend aussi dans Réviser, et en PDF à imprimer ou à relire dans le métro.",

  "discovery.stats.title": "Tes chiffres, sur ton appareil",
  "discovery.stats.body": "L'onglet Statistiques montre ce qui avance : les jours travaillés, ta réussite, ce à quoi passe le temps. Tout est calculé ici et n'est envoyé nulle part.",

  "discovery.offline.title": "Ça marche dans le métro",
  "discovery.offline.body": "Parlo s'installe comme une application et fonctionne sans réseau. Tu peux apprendre sans compte ; en créer un ne sert qu'à retrouver ta progression ailleurs.",
} as const;

export const en: Record<keyof typeof fr, string> = {
  "discovery.step": "{i} of {n}",
  "discovery.next": "Next",
  "discovery.done": "Let's go",
  "discovery.skip": "Skip the tour",
  "discovery.back": "Previous",
  "discovery.replay": "Take the tour again",
  "discovery.replay.hint": "Bubbles on the path screen, to know where everything is.",

  "tour.welcome.title": "Welcome to your path",
  "tour.welcome.body": "This is the screen you will come back to every day. A few bubbles show you where everything is: go at your pace, or skip the tour.",
  "tour.help.title": "See this tour again",
  "tour.help.body": "Unsure about a button? Tap the \"?\" at any time: the tour starts again from the beginning.",
  "tour.help.button": "Take the guided tour again",

  "discovery.path.title": "Your journey goes up the river",
  "discovery.path.body": "Each stop is a level: a handful of words, twenty exercises, a mark out of 20. Levels open once the previous one is mastered — never because you paid or waited.",

  "discovery.session.title": "One session a day, your size",
  "discovery.session.body": "You picked {n} minutes. The session fits in that time: today's level, plus the words your memory is about to drop.",

  "discovery.review.title": "Nothing you meet is lost",
  "discovery.review.body": "Every word you see joins your library and comes back just before you forget it. The Review tab keeps it all: words, dialogues, tip sheets, your notes.",

  "discovery.memo.title": "A sheet to take away at every level",
  "discovery.memo.body": "When a level ends, a cheat sheet appears: the words, the rules, the Southern pitfalls. It also waits for you in Review, and as a PDF to print or re-read on the train.",

  "discovery.stats.title": "Your numbers, on your device",
  "discovery.stats.body": "The Statistics tab shows what is moving: days practised, your accuracy, where the time goes. It is all computed here and sent nowhere.",

  "discovery.offline.title": "It works on the underground",
  "discovery.offline.body": "Parlo installs like an app and runs without a network. You can learn with no account; creating one only helps you find your progress elsewhere.",
};
