/** Chaînes d'interface du défi de la semaine (spec §5.2). */
export const fr = {
  "challenges.label": "Défi de la semaine",
  "challenges.kind.words_theme": "{n} mots nouveaux cette semaine",
  "challenges.kind.streak_days": "{n} jours de suite",
  "challenges.kind.speaking_minutes": "{n} minutes de parole",
  "challenges.kind.lessons": "{n} leçons cette semaine",
  "challenges.kind.game_score": "{n} parties réussies aux jeux",
  "challenges.progress": "{done} sur {target}",
  "challenges.until": "Jusqu'au {date}",
  "challenges.claim": "Récupérer le badge",
  "challenges.claiming": "Un instant…",
  "challenges.claimed": "Badge récupéré",
  "challenges.claimedXp": "Badge récupéré · +{n} XP",
  "challenges.claimOffline": "Le badge se récupère en ligne.",
  "challenges.localNote": "Calculé sur ce téléphone",
} as const;

export const en: Partial<Record<keyof typeof fr, string>> = {
  "challenges.label": "Weekly challenge",
  "challenges.kind.words_theme": "{n} new words this week",
  "challenges.kind.streak_days": "{n} days in a row",
  "challenges.kind.speaking_minutes": "{n} minutes of speaking",
  "challenges.kind.lessons": "{n} lessons this week",
  "challenges.kind.game_score": "{n} games won",
  "challenges.progress": "{done} of {target}",
  "challenges.claim": "Claim the badge",
  "challenges.claimed": "Badge claimed",
};
