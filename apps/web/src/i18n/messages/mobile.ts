/** Mobile et PWA : installation iOS, lecture audio bloquée, mise à jour du service worker, chunks périmés. */
export const fr = {
  "mobile.install.iosOther": "Ouvre Parlo dans Safari pour l'installer : touche Partager, puis « Sur l'écran d'accueil ».",
  "mobile.audio.tapToListen": "Touche pour écouter",
  "mobile.update.available": "Nouvelle version disponible",
  "mobile.update.cta": "Mettre à jour",
  "mobile.update.later": "Plus tard",
  "mobile.chunk.title": "Parlo vient d'être mis à jour",
  "mobile.chunk.body": "Cette page n'a pas pu se charger (nouvelle version ou connexion coupée). Recharge pour continuer, ta progression est gardée.",
  "mobile.chunk.reload": "Recharger",
  "mobile.chunk.home": "Retour au parcours",
} as const;

export const en: Record<keyof typeof fr, string> = {
  "mobile.install.iosOther": "Open Parlo in Safari to install it: tap Share, then “Add to Home Screen”.",
  "mobile.audio.tapToListen": "Tap to listen",
  "mobile.update.available": "New version available",
  "mobile.update.cta": "Update",
  "mobile.update.later": "Later",
  "mobile.chunk.title": "Parlo has just been updated",
  "mobile.chunk.body": "This page couldn't load (new version or lost connection). Reload to continue, your progress is kept.",
  "mobile.chunk.reload": "Reload",
  "mobile.chunk.home": "Back to the path",
};
