/**
 * Chaînes d'interface du catalogue complet d'exercices (contrat phase6) : écrits avec le clavier
 * vietnamien, appariement, trou à combler, écoute globale, dialogue à embranchements et oraux libres.
 * Rien ici n'enseigne la langue : le contenu vient des packs (ADR 0002).
 */
export const fr = {
  // Clavier vietnamien (spec §8.4)
  "exercise.keyboard.bar": "Accents et lettres du vietnamien",
  "exercise.keyboard.method": "Saisie :",
  "exercise.keyboard.telex": "Telex",
  "exercise.keyboard.vni": "VNI",
  "exercise.keyboard.letterKey": "{letter} (touche {shortcut})",
  "exercise.keyboard.toneKey": "Ton {tone} (touche {shortcut})",
  "exercise.keyboard.toneNone": "Enlever le ton",

  // Exercices écrits
  "exercise.transcribe.prompt": "Écris ce que tu entends",
  "exercise.translateToVi.prompt": "Dis-le en vietnamien",
  "exercise.translateToFr.prompt": "Qu'est-ce que ça veut dire ?",
  "exercise.answer.label": "Ta réponse",
  "exercise.answer.labelVi": "Ta réponse en vietnamien",
  "exercise.nearMiss": "Presque : c'est « {expected} », pas « {given} ».",

  // Trou à combler
  "exercise.fillGap.prompt": "Complète la phrase",
  "exercise.fillGap.empty": "Mot à choisir",
  "exercise.fillGap.options": "Mots proposés",

  // Appariement
  "exercise.match.prompt": "Associe les paires",
  "exercise.match.progress": "{n} paire(s) sur {total}",
  "exercise.match.result": "{n} bonne(s) association(s) sur {total}",
  "exercise.match.audioCard": "Carte à écouter",

  // Écoute globale
  "exercise.gist.prompt": "Écoute la conversation",
  "exercise.gist.listen": "Écouter",
  "exercise.gist.again": "Réécouter",
  "exercise.gist.transcriptsAfter": "Le texte s'affiche après {n} écoutes.",

  // Dialogue à embranchements
  "exercise.dialogue.prompt": "À toi de répondre",
  "exercise.dialogue.character": "La conversation",
  "exercise.dialogue.yourTurn": "Que réponds-tu ?",
  "exercise.dialogue.summary": "Ce que tu as dit",
  "exercise.dialogue.youSaid": "Toi :",
  "exercise.dialogue.better": "Encore mieux :",

  // Oraux libres
  "exercise.speak.answer": "Réponds à voix haute",
  "exercise.speak.roleplay": "Dis ta réplique",
  "exercise.speak.roleplayStep": "Réplique {i} sur {n}",
  "exercise.speak.next": "Réplique suivante",
} as const;

export const en: Record<keyof typeof fr, string> = {
  "exercise.keyboard.bar": "Vietnamese letters and tone marks",
  "exercise.keyboard.method": "Input:",
  "exercise.keyboard.telex": "Telex",
  "exercise.keyboard.vni": "VNI",
  "exercise.keyboard.letterKey": "{letter} (key {shortcut})",
  "exercise.keyboard.toneKey": "{tone} tone (key {shortcut})",
  "exercise.keyboard.toneNone": "Remove the tone",

  "exercise.transcribe.prompt": "Type what you hear",
  "exercise.translateToVi.prompt": "Say it in Vietnamese",
  "exercise.translateToFr.prompt": "What does this mean?",
  "exercise.answer.label": "Your answer",
  "exercise.answer.labelVi": "Your answer in Vietnamese",
  "exercise.nearMiss": "Almost: it's “{expected}”, not “{given}”.",

  "exercise.fillGap.prompt": "Complete the sentence",
  "exercise.fillGap.empty": "Word to choose",
  "exercise.fillGap.options": "Suggested words",

  "exercise.match.prompt": "Match the pairs",
  "exercise.match.progress": "{n} of {total} pairs",
  "exercise.match.result": "{n} of {total} matches are right",
  "exercise.match.audioCard": "Audio card",

  "exercise.gist.prompt": "Listen to the conversation",
  "exercise.gist.listen": "Listen",
  "exercise.gist.again": "Listen again",
  "exercise.gist.transcriptsAfter": "The text appears after {n} listens.",

  "exercise.dialogue.prompt": "Your turn to answer",
  "exercise.dialogue.character": "The conversation",
  "exercise.dialogue.yourTurn": "What do you say?",
  "exercise.dialogue.summary": "What you said",
  "exercise.dialogue.youSaid": "You:",
  "exercise.dialogue.better": "Even better:",

  "exercise.speak.answer": "Answer out loud",
  "exercise.speak.roleplay": "Say your line",
  "exercise.speak.roleplayStep": "Line {i} of {n}",
  "exercise.speak.next": "Next line",
};
