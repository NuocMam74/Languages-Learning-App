/** Chaînes d'interface des rappels (spec §5.8). Jamais culpabilisant. */
export const fr = {
  "notif.settings.title": "Rappels",
  "notif.settings.toggle": "Un rappel par jour",
  "notif.settings.hint": "Au plus un par jour, et seulement si tu n'as pas encore fait ta séance.",
  "notif.settings.hour": "Heure du rappel",
  "notif.settings.hourValue": "{h} h",
  "notif.settings.denied": "Les notifications sont bloquées dans les réglages du navigateur.",
  "notif.settings.unsupported": "Ce navigateur ne gère pas les notifications.",
  "notif.settings.account": "Les rappels demandent un compte.",
  "notif.settings.offline": "Connecte-toi à internet pour changer les rappels.",
  "notif.settings.error": "Impossible d'activer les rappels pour le moment.",
  "notif.prompt.title": "Cô Mai peut te faire signe",
  "notif.prompt.body": "Trois séances déjà. Un petit rappel à l'heure de ton choix t'aiderait à garder le rythme ?",
  "notif.prompt.yes": "Choisir mon heure",
  "notif.prompt.no": "Pas maintenant",
  "notif.page.title": "Un rappel, pas une alarme",
  "notif.page.body": "Une notification par jour au maximum, à l'heure que tu choisis, seulement si tu n'as pas encore pratiqué. Tu peux l'arrêter à tout moment dans les réglages.",
  "notif.page.example": "« 6 minutes, et tu sais commander un café ce soir. »",
  "notif.page.enable": "Activer les rappels",
  "notif.page.enabling": "Activation…",
  "notif.page.done": "C'est noté. À demain, {h} h.",
  "notif.page.later": "Plus tard",
  "notif.ios.title": "D'abord, installe Parlo",
  "notif.ios.body": "Sur iPhone, les rappels ne marchent que si Parlo est sur l'écran d'accueil : touche Partager, puis « Sur l'écran d'accueil », et rouvre Parlo depuis son icône.",
} as const;

export const en: Partial<Record<keyof typeof fr, string>> = {
  "notif.settings.title": "Reminders",
  "notif.settings.toggle": "One reminder a day",
  "notif.settings.hour": "Reminder time",
  "notif.page.enable": "Turn on reminders",
  "notif.page.later": "Later",
};
