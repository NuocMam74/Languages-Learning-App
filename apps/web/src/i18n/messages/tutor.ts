/** Cô Mai dans l'interface (spec §5.7). Jamais culpabilisant (spec §5.8). */
export const fr = {
  "tutor.name": "Cô Mai",
  "tutor.why": "Cô Mai, pourquoi ?",
  "tutor.thinking": "Cô Mai réfléchit…",
  "tutor.why.offline": "Je t'explique plus en détail quand tu es connecté·e. En attendant, retiens la phrase juste au-dessus.",
  "tutor.why.offlineNoExplain": "Je t'explique plus en détail quand tu es connecté·e. Réécoute la bonne réponse, sans te presser.",
  "tutor.greeting.morning": "Bonjour !",
  "tutor.greeting.afternoon": "Rebonjour !",
  "tutor.greeting.evening": "Bonsoir !",
  "tutor.greeting.streak": "{n} jours d'affilée, on continue tranquillement.",
  "tutor.greeting.doneToday": "C'est fait pour aujourd'hui. Un petit rappel en plus, si ça te dit.",
  "tutor.greeting.default": "Quelques minutes ensemble, et tu en sauras un peu plus qu'hier.",
} as const;

export const en: Partial<Record<keyof typeof fr, string>> = {
  "tutor.why": "Cô Mai, why?",
  "tutor.thinking": "Cô Mai is thinking…",
  "tutor.why.offline": "I'll explain in more detail once you're signed in and online. Meanwhile, keep the sentence just above in mind.",
  "tutor.why.offlineNoExplain": "I'll explain in more detail once you're signed in and online. Listen to the right answer again, no rush.",
  "tutor.greeting.morning": "Good morning!",
  "tutor.greeting.afternoon": "Hello again!",
  "tutor.greeting.evening": "Good evening!",
  "tutor.greeting.streak": "{n} days in a row, let's keep an easy pace.",
  "tutor.greeting.doneToday": "Done for today. One more short review if you feel like it.",
  "tutor.greeting.default": "A few minutes together, and you'll know a bit more than yesterday.",
};
