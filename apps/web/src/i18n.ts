import type { Localized, Tone } from "@parlo/core";
import { localize } from "@parlo/core";

/**
 * Chaînes d'interface uniquement. Le contenu pédagogique vient des packs
 * (ADR 0002) ; rien ici ne doit enseigner la langue.
 */
const fr = {
  "common.back": "Retour",
  "welcome.noAlphabet": "Pas d'alphabet à apprendre : le vietnamien s'écrit en lettres latines.",
  "welcome.start": "Commencer",
  "welcome.replay": "Réécouter",
  "chooseLang.title": "Quelle langue veux-tu parler ?",
  "chooseLang.soon": "bientôt",
  "onboarding.why": "Pourquoi le vietnamien ?",
  "onboarding.why.family": "Pour la famille",
  "onboarding.why.travel": "Pour voyager",
  "onboarding.why.work": "Pour le travail",
  "onboarding.why.roots": "Pour mes racines",
  "onboarding.why.curiosity": "Par curiosité",
  "onboarding.who": "Qui parle vietnamien autour de toi ?",
  "onboarding.who.nobody": "Personne",
  "onboarding.who.partner": "Mon ou ma partenaire",
  "onboarding.who.parents": "Mes parents ou grands-parents",
  "onboarding.who.colleagues": "Des collègues",
  "onboarding.level": "Tu comprends déjà un peu ?",
  "onboarding.level.none": "Rien du tout",
  "onboarding.level.words": "Quelques mots",
  "onboarding.level.understand": "Je comprends mais je ne parle pas",
  "onboarding.level.speak": "Je parle un peu",
  "onboarding.minutes": "Combien de temps par jour ?",
  "onboarding.minutes.value": "{n} min",
  "onboarding.reminder": "Quand veux-tu qu'on te rappelle ?",
  "onboarding.reminder.morning": "Le matin",
  "onboarding.reminder.noon": "À midi",
  "onboarding.reminder.evening": "Le soir",
  "onboarding.reminder.none": "Pas de rappel",
  "onboarding.step": "Question {i} sur {n}",
  "hub.daily": "Séance du jour",
  "hub.minutes": "{n} min",
  "hub.streak": "{n} jour de suite",
  "hub.streak.plural": "{n} jours de suite",
  "hub.freezes": "{n} protection de série",
  "hub.freezes.plural": "{n} protections de série",
  "hub.xp": "{n} XP",
  "hub.path": "Ton parcours",
  "hub.done": "Toutes les leçons disponibles sont terminées. De nouvelles unités arrivent.",
  "hub.guest": "Mode invité : ta progression reste sur cet appareil.",
  "hub.offline": "Hors ligne — tout fonctionne, on synchronisera plus tard.",
  "lesson.check": "Valider",
  "lesson.continue": "Continuer",
  "lesson.skip": "Passer",
  "lesson.quit": "Quitter la leçon",
  "lesson.progress": "Étape {i} sur {n}",
  "lesson.correct": "Juste !",
  "lesson.wrong": "Pas tout à fait.",
  "lesson.nearMiss": "Presque : c'est « {expected} ».",
  "lesson.answerLabel": "Réponse :",
  "lesson.retryLater": "On la revoit en fin de leçon.",
  "lesson.tutorNudge": "Cô Mai : on ralentit un peu sur « {word} ». Écoute encore, sans te presser.",
  "ex.listen": "Écoute et choisis",
  "ex.listenPickImage": "Qui est-ce ?",
  "ex.toneIdentify": "Quel ton entends-tu ?",
  "ex.toneMinimalPair": "Lequel entends-tu ?",
  "ex.spotTheSouth": "À Saïgon, pour « {gloss} », on dit…",
  "ex.buildSentence": "Construis la phrase",
  "ex.buildSentence.clear": "Effacer",
  "ex.speakRepeat": "Répète à voix haute",
  "ex.speakRepeat.done": "C'est fait",
  "ex.speakRepeat.soon": "L'analyse de ta prononciation arrive bientôt. Pour l'instant, écoute et répète.",
  "ex.culture.question": "Petite question",
  "ex.game.soon": "Le mini-jeu {name} arrive bientôt.",
  "ex.unsupported": "Cet exercice n'est pas encore disponible.",
  "audio.play": "Écouter",
  "audio.slow": "Plus lentement",
  "audio.missing": "Audio natif pas encore enregistré",
  "audio.tts": "voix de synthèse",
  "recap.title": "Leçon terminée",
  "recap.canSay": "Aujourd'hui, tu sais dire de plus :",
  "recap.xp": "+{n} XP",
  "recap.streak": "Série : {n}",
  "recap.next": "Retour au parcours",
  "install.title": "Installer Parlo",
  "install.ios": "Dans Safari : touche Partager, puis « Sur l'écran d'accueil ».",
  "install.android": "Ajoute Parlo à ton écran d'accueil pour l'ouvrir comme une app, même hors ligne.",
  "install.cta": "Installer",
  "install.later": "Plus tard",
  "tone.ngang": "ngang — plat",
  "tone.huyen": "huyền — descend",
  "tone.sac": "sắc — monte",
  "tone.hoi_nga": "hỏi / ngã — plonge",
  "tone.hoi": "hỏi — plonge",
  "tone.nga": "ngã — plonge",
  "tone.nang": "nặng — tombe court",
  "game.cho_noi": "Chợ nổi",
  "game.karaoke_tonal": "Karaoké tonal",
  "game.xe_om": "Xe ôm",
  "game.bua_com": "Bữa cơm",
  "game.doi_dap": "Đối đáp",
  "game.nho_mat": "Nhớ mặt",
  "error.content": "Le contenu n'a pas pu être chargé. Vérifie ta connexion pour ce premier lancement.",
  "error.retry": "Réessayer",
} as const;

export type MessageKey = keyof typeof fr;

const en: Partial<Record<MessageKey, string>> = {
  "welcome.noAlphabet": "No alphabet to learn: Vietnamese uses Latin letters.",
  "welcome.start": "Start",
  "hub.daily": "Today's session",
  "lesson.check": "Check",
  "lesson.continue": "Continue",
  "lesson.correct": "Correct!",
  "lesson.wrong": "Not quite.",
  "recap.title": "Lesson complete",
};

const dictionaries: Record<string, Partial<Record<MessageKey, string>>> = { fr, en };

export function getLocale(): "fr" | "en" {
  return navigator.language.toLowerCase().startsWith("fr") ? "fr" : navigator.language ? "en" : "fr";
}

export function t(key: MessageKey, vars: Record<string, string | number> = {}, locale = getLocale()): string {
  const template = dictionaries[locale]?.[key] ?? fr[key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export function plural(key: MessageKey, pluralKey: MessageKey, n: number): string {
  return t(n > 1 ? pluralKey : key, { n });
}

export function toneLabel(tones: readonly Tone[]): string {
  if (tones.length === 2 && tones.includes("hoi") && tones.includes("nga")) return t("tone.hoi_nga");
  return tones.map((tone) => t(`tone.${tone}` as MessageKey)).join(" / ");
}

export function l(text: Localized | null | undefined): string {
  return text ? localize(text, getLocale()) : "";
}
