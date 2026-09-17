/**
 * Missions quotidiennes, hebdomadaires et mensuelles (contrat phase9 §3).
 *
 * Un libellé de mission dit **ce qu'il y a à faire**, jamais ce qu'on risque de perdre : pas de
 * compte à rebours anxiogène, pas de « vite ! » (spec §5.8). « Il reste 2 jours » est une
 * information utile ; « plus que 2 jours ! » serait une pression.
 */
export const fr = {
  "missions.title": "Missions",
  "missions.intro": "Trois du jour, trois de la semaine, deux du mois. Elles se renouvellent seules.",
  "missions.nav": "Missions",
  "missions.open": "Voir mes missions",
  "missions.claimable": "{n} à réclamer",
  "missions.none": "Rien à réclamer pour l'instant",
  "missions.empty.title": "Pas de mission ici",
  "missions.empty.body": "Commence une séance : les missions du jour arrivent avec elle.",
  "missions.progress": "{done} sur {total}",
  "missions.claim": "Réclamer",
  "missions.claim.label": "Réclamer la récompense de « {name} »",
  "missions.claimed": "Réclamée",
  "missions.reward": "{n} xu",
  "missions.reward.chest": "{n} xu et un coffre",

  "mission.period.daily": "Aujourd'hui",
  "mission.period.weekly": "Cette semaine",
  "mission.period.monthly": "Ce mois",
  "mission.period.daily.done": "Mission du jour accomplie",
  "mission.period.weekly.done": "Mission de la semaine accomplie",
  "mission.period.monthly.done": "Mission du mois accomplie",
  "mission.endsToday": "Jusqu'à ce soir",
  "mission.endsIn": "Encore {n} jours",
  "mission.endsTomorrow": "Jusqu'à demain",

  // Libellés courts, avec la cible : « 16 exercices », « 2 séances ».
  "mission.items.label": "{n} exercices",
  "mission.correct.label": "{n} bonnes réponses",
  "mission.sessions.label": "{n} séances terminées",
  "mission.lessons.label": "{n} leçons terminées",
  "mission.games.label": "{n} parties jouées",
  "mission.gameWins.label": "{n} parties réussies",
  "mission.perfect.label": "{n} leçons sans faute",
  "mission.review.label": "{n} mots révisés",
  "mission.newWords.label": "{n} mots nouveaux",
  "mission.tones.label": "{n} exercices de tons",
  "mission.speak.label": "{n} phrases prononcées",
  "mission.xp.label": "{n} XP",
  "mission.minutes.label": "{n} minutes",
} as const;

export const en: Record<keyof typeof fr, string> = {
  "missions.title": "Missions",
  "missions.intro": "Three for today, three for the week, two for the month. They renew on their own.",
  "missions.nav": "Missions",
  "missions.open": "See my missions",
  "missions.claimable": "{n} to claim",
  "missions.none": "Nothing to claim right now",
  "missions.empty.title": "No mission here",
  "missions.empty.body": "Start a session: today's missions come with it.",
  "missions.progress": "{done} of {total}",
  "missions.claim": "Claim",
  "missions.claim.label": "Claim the reward for “{name}”",
  "missions.claimed": "Claimed",
  "missions.reward": "{n} xu",
  "missions.reward.chest": "{n} xu and a chest",

  "mission.period.daily": "Today",
  "mission.period.weekly": "This week",
  "mission.period.monthly": "This month",
  "mission.period.daily.done": "Today's mission done",
  "mission.period.weekly.done": "This week's mission done",
  "mission.period.monthly.done": "This month's mission done",
  "mission.endsToday": "Until tonight",
  "mission.endsIn": "{n} days left",
  "mission.endsTomorrow": "Until tomorrow",

  "mission.items.label": "{n} exercises",
  "mission.correct.label": "{n} right answers",
  "mission.sessions.label": "{n} sessions finished",
  "mission.lessons.label": "{n} lessons finished",
  "mission.games.label": "{n} rounds played",
  "mission.gameWins.label": "{n} rounds won",
  "mission.perfect.label": "{n} lessons without a mistake",
  "mission.review.label": "{n} words reviewed",
  "mission.newWords.label": "{n} new words",
  "mission.tones.label": "{n} tone exercises",
  "mission.speak.label": "{n} sentences spoken",
  "mission.xp.label": "{n} XP",
  "mission.minutes.label": "{n} minutes",
};
