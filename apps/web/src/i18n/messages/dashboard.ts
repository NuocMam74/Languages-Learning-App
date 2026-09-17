/** Accueil général et navigation basse (contrat phase7 §1, §2). */
export const fr = {
  // Navigation basse
  "nav.home": "Accueil",
  "nav.learn": "Apprendre",
  "nav.games": "Jeux",
  "nav.review": "Réviser",
  "nav.profile": "Profil",
  "nav.label": "Navigation principale",

  // En-tête
  "dashboard.hello.morning": "Bonjour, {name}",
  "dashboard.hello.afternoon": "Bon après-midi, {name}",
  "dashboard.hello.evening": "Bonsoir, {name}",
  "dashboard.guest": "invité",
  "dashboard.openProfile": "Mon profil",
  "dashboard.xp": "{n} XP",
  "dashboard.streak": "{n} jour de suite",
  "dashboard.streak.plural": "{n} jours de suite",
  "dashboard.streak.none": "Aucune série en cours",

  // Reprendre
  "dashboard.resume.title": "Reprendre",
  "dashboard.resume.next": "Prochaine leçon",
  "dashboard.resume.daily": "Séance du jour",
  "dashboard.resume.start": "Commencer",
  "dashboard.resume.continue": "Continuer",
  "dashboard.minutes": "{n} min",
  "dashboard.resume.due": "{n} mot à revoir",
  "dashboard.resume.due.plural": "{n} mots à revoir",
  "dashboard.resume.unitProgress": "{done} / {total} leçons",
  "dashboard.resume.done": "Parcours terminé pour cette langue",

  // Mes langues
  "dashboard.languages.title": "Mes langues",
  "dashboard.languages.add": "Ajouter une langue",
  "dashboard.lang.lessons": "{done} / {total} leçons",
  "dashboard.lang.units": "{n} unité validée",
  "dashboard.lang.units.plural": "{n} unités validées",
  "dashboard.lang.never": "Pas encore commencée",
  "dashboard.lang.lastActive": "Dernière séance le {date}",
  "dashboard.lang.open": "Apprendre le {name}",
  "dashboard.lang.active": "Langue en cours",
  "dashboard.lang.unavailable": "Contenu pas encore téléchargé",

  // Motivation
  "dashboard.motivation.title": "Ton élan",
  "dashboard.badges.recent": "Derniers badges",
  "dashboard.badges.all": "Tout voir",
  "dashboard.certificate.title": "Prochain certificat",
  "dashboard.certificate.ready": "{name} : tu peux tenter l'examen",
  "dashboard.tutor.title": "Cô Mai",
  "dashboard.tutor.talk": "Parler avec Cô Mai",
  "dashboard.tutor.debrief": "Mon bilan de la semaine",

  // Première ouverture
  "dashboard.first.title": "Ton compte, tes langues",
  "dashboard.first.body": "Ici tu retrouveras tout : la langue que tu apprends, ta série, tes badges. On commence par une première séance.",
  "dashboard.first.cta": "Commencer ma première leçon",
  "dashboard.first.guest": "Crée un compte quand tu veux : rien n'est perdu d'ici là.",

  // Lien profond vers une autre langue
  "dashboard.deepLink.title": "Cette leçon est en {name}",
  "dashboard.deepLink.body": "Ouvrir ce lien change la langue que tu apprends. Ta progression dans l'autre langue reste intacte.",
  "dashboard.deepLink.confirm": "Passer au {name}",
  "dashboard.deepLink.cancel": "Rester sur ma langue",

  // États
  "dashboard.offline": "Hors ligne : tu vois ta progression enregistrée sur cet appareil.",
  "dashboard.loading": "Chargement de ta progression",
  // Invitation à finir sa configuration (contrat phase10 §4) : une invitation, jamais un reproche.
  "setup.title": "Rends cet espace un peu tien",
  "setup.body": "Deux minutes, et l'app te parlera par ton nom.",
  "setup.name": "Choisir mon nom",
  "setup.character": "Habiller mon personnage",
  "setup.later": "Plus tard",
} as const;

export const en: Record<keyof typeof fr, string> = {
  "nav.home": "Home",
  "nav.learn": "Learn",
  "nav.games": "Games",
  "nav.review": "Review",
  "nav.profile": "Profile",
  "nav.label": "Main navigation",

  "dashboard.hello.morning": "Good morning, {name}",
  "dashboard.hello.afternoon": "Good afternoon, {name}",
  "dashboard.hello.evening": "Good evening, {name}",
  "dashboard.guest": "guest",
  "dashboard.openProfile": "My profile",
  "dashboard.xp": "{n} XP",
  "dashboard.streak": "{n} day in a row",
  "dashboard.streak.plural": "{n} days in a row",
  "dashboard.streak.none": "No streak going",

  "dashboard.resume.title": "Pick up again",
  "dashboard.resume.next": "Next lesson",
  "dashboard.resume.daily": "Today's session",
  "dashboard.resume.start": "Start",
  "dashboard.resume.continue": "Continue",
  "dashboard.minutes": "{n} min",
  "dashboard.resume.due": "{n} word to review",
  "dashboard.resume.due.plural": "{n} words to review",
  "dashboard.resume.unitProgress": "{done} / {total} lessons",
  "dashboard.resume.done": "Path finished for this language",

  "dashboard.languages.title": "My languages",
  "dashboard.languages.add": "Add a language",
  "dashboard.lang.lessons": "{done} / {total} lessons",
  "dashboard.lang.units": "{n} unit passed",
  "dashboard.lang.units.plural": "{n} units passed",
  "dashboard.lang.never": "Not started yet",
  "dashboard.lang.lastActive": "Last session on {date}",
  "dashboard.lang.open": "Learn {name}",
  "dashboard.lang.active": "Current language",
  "dashboard.lang.unavailable": "Content not downloaded yet",

  "dashboard.motivation.title": "Your momentum",
  "dashboard.badges.recent": "Latest badges",
  "dashboard.badges.all": "See all",
  "dashboard.certificate.title": "Next certificate",
  "dashboard.certificate.ready": "{name}: you can sit the exam",
  "dashboard.tutor.title": "Cô Mai",
  "dashboard.tutor.talk": "Talk with Cô Mai",
  "dashboard.tutor.debrief": "My week in review",

  "dashboard.first.title": "Your account, your languages",
  "dashboard.first.body": "Everything lives here: the language you're learning, your streak, your badges. Let's start with a first session.",
  "dashboard.first.cta": "Start my first lesson",
  "dashboard.first.guest": "Create an account whenever you like: nothing is lost until then.",

  "dashboard.deepLink.title": "This lesson is in {name}",
  "dashboard.deepLink.body": "Opening this link changes the language you're learning. Your progress in the other language stays untouched.",
  "dashboard.deepLink.confirm": "Switch to {name}",
  "dashboard.deepLink.cancel": "Stay on my language",

  "dashboard.offline": "Offline: you're seeing the progress saved on this device.",
  "dashboard.loading": "Loading your progress",
  "setup.title": "Make this place yours",
  "setup.body": "Two minutes, and the app will call you by your name.",
  "setup.name": "Choose my name",
  "setup.character": "Dress my character",
  "setup.later": "Later",
};
